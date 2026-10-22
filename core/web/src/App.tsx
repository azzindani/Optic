import { useCallback, useEffect, useRef, useState } from "react";
import { api, colorFor, type Box, type EntityHit, type GpuStatus, type Job, type ToolManifest } from "./api";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

interface Ev { type: string; data: unknown }
type Route = "review" | "jobs" | "graph";

// Multi-page PDF viewer: renders the stored input at ~100 dpi so OCR
// boxes (100 dpi space) overlay 1:1. Det boxes (det:* from unlimited-ocr)
// arrive in 0-1000 normalized space and are scaled to the canvas. When
// livePage matches, the newest box glows as the reading cursor.
function PdfView({ jobId, page, boxes, livePage, src }: {
  jobId: string; page: number; boxes: Box[]; livePage?: number | null; src?: ArrayBuffer | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overRef = useRef<HTMLCanvasElement>(null);
  const [dims, setDims] = useState({ w: 826, h: 1168 });
  const [err, setErr] = useState("");

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const buf = src ?? await (await fetch(api.inputUrl(jobId))).arrayBuffer();
        const pdf = await pdfjs.getDocument({ data: buf.slice(0) }).promise;
        if (dead) return;
        const pg = await pdf.getPage(Math.min(page, pdf.numPages));
        const vp = pg.getViewport({ scale: 100 / 72 });
        const c = canvasRef.current;
        if (!c) return;
        c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        setDims({ w: c.width, h: c.height });
        await pg.render({ canvas: c, viewport: vp }).promise;
      } catch (e) { if (!dead) setErr(String((e as Error).message).slice(0, 120)); }
    })();
    return () => { dead = true; };
  }, [jobId, page, src]);

  useEffect(() => {
    const c = overRef.current;
    const base = canvasRef.current;
    if (!c || !base || !base.width) return;
    c.width = base.width; c.height = base.height;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    const live = livePage === page;
    boxes.forEach((raw, i) => {
      // Det boxes are 0-1000 normalized; everything else is 100dpi pixels.
      const b = raw.kind?.startsWith("det:")
        ? { ...raw, x: (raw.x / 1000) * c.width, y: (raw.y / 1000) * c.height,
            w: (raw.w / 1000) * c.width, h: (raw.h / 1000) * c.height }
        : raw;
      const isCursor = live && i === boxes.length - 1;
      const color = colorFor(b.kind);
      ctx.strokeStyle = color;
      ctx.lineWidth = isCursor ? 4 : b.kind?.startsWith("entity:") ? 3 : 2;
      if (isCursor) { ctx.shadowColor = color; ctx.shadowBlur = 12; }
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.shadowBlur = 0;
      if ((b.kind?.startsWith("entity:") || isCursor) && b.label) {
        ctx.font = "14px system-ui, sans-serif";
        const tw = ctx.measureText(b.label).width;
        const ty = Math.max(0, b.y - 20);
        ctx.fillStyle = color;
        ctx.fillRect(b.x, ty, tw + 8, 20);
        ctx.fillStyle = "#fff";
        ctx.fillText(b.label, b.x + 4, ty + 15);
      }
    });
  });

  if (err) return <div className="empty err">{err}</div>;
  return (
    <div className="docpage" style={{ aspectRatio: `${dims.w} / ${dims.h}` }}>
      <canvas ref={canvasRef} className="docbase" />
      <canvas ref={overRef} className="docover" />
    </div>
  );
}

const pillFor = (status: string): { label: string; cls: string } => {
  const s = status.toLowerCase();
  if (s === "done") return { label: "Done", cls: "pill done" };
  if (s === "active") return { label: "Active", cls: "pill prog" };
  if (s === "error") return { label: "Error", cls: "pill hold" };
  if (s === "interrupted") return { label: "Interrupted", cls: "pill hold" };
  return { label: "Queued", cls: "pill todo" };
};

export default function App() {
  const [route, setRoute] = useState<Route>("review");
  const [tools, setTools] = useState<ToolManifest[]>([]);
  const [gpu, setGpu] = useState<GpuStatus | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [toolId, setToolId] = useState("turbo-tiny");
  const [mode, setMode] = useState("live");
  const [events, setEvents] = useState<Ev[]>([]);
  const [markdown, setMarkdown] = useState("");
  const [fields, setFields] = useState("");
  const [entities, setEntities] = useState<EntityHit[]>([]);
  const [pageBoxes, setPageBoxes] = useState<Record<number, Box[]>>({});
  const [page, setPage] = useState(1);
  const [livePage, setLivePage] = useState<number | null>(null);
  const [pdfBuf, setPdfBuf] = useState<ArrayBuffer | null>(null);
  const [schemas, setSchemas] = useState<{ id: string; label: string }[]>([]);
  const [schemaId, setSchemaId] = useState("invoice");
  const [result, setResult] = useState("");
  const [tab, setTab] = useState<"entities" | "text" | "tables" | "events">("entities");
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [imgSize, setImgSize] = useState({ w: 960, h: 540 });
  const [err, setErr] = useState("");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const esRef = useRef<EventSource | null>(null);
  const loadResultForRef = useRef<(id: string) => Promise<void>>(async () => {});
  loadResultForRef.current = (id: string) => loadResultFor(id, schemaId);

  const refresh = useCallback(async () => {
    try {
      const [t, g, j, s] = await Promise.all([api.tools(), api.gpu(), api.jobs(), api.schemas()]);
      setTools(t); setGpu(g); setJobs(j); setSchemas(s);
      if (!t.find((x) => x.id === toolId) && t[0]) setToolId(t[0].id);
    } catch (e) { setErr(String((e as Error).message)); }
  }, [toolId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const c = overlayRef.current;
    if (!c) return;
    c.width = imgSize.w; c.height = imgSize.h;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    for (const b of boxes) {
      const color = colorFor(b.kind);
      ctx.strokeStyle = color;
      ctx.lineWidth = b.kind?.startsWith("entity:") ? Math.max(3, c.width / 300) : Math.max(2, c.width / 400);
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      if (b.kind?.startsWith("entity:") && b.label) {
        ctx.font = `${Math.max(12, c.width / 60)}px system-ui, sans-serif`;
        const tw = ctx.measureText(b.label).width;
        const ty = Math.max(0, b.y - 18);
        ctx.fillStyle = color;
        ctx.fillRect(b.x, ty, tw + 8, 18);
        ctx.fillStyle = "#fff";
        ctx.fillText(b.label, b.x + 4, ty + 13);
      }
    }
  }, [boxes, imgSize]);

  const openJob = useCallback((id: string) => {
    setSel(id); setEvents([]); setMarkdown(""); setFields(""); setBoxes([]); setEntities([]);
    setPageBoxes({}); setPage(1); setResult(""); setLivePage(null); setPdfBuf(null);
    void loadResultForRef.current(id);
    esRef.current?.close();
    const es = new EventSource(`/v1/jobs/${id}/events`);
    esRef.current = es;
    for (const type of ["status", "page", "box", "markdown", "fields"]) {
      es.addEventListener(type, (ev) => {
        const data = JSON.parse((ev as MessageEvent).data) as Record<string, unknown>;
        setEvents((p) => [{ type, data }, ...p].slice(0, 100));
        if (type === "markdown" && typeof data.text === "string")
          setMarkdown((p) => p + (data.text as string) + "\n");
        if (type === "fields") {
          setFields(JSON.stringify(data, null, 2));
          if (Array.isArray((data as { entities?: unknown }).entities))
            setEntities((data as { entities: EntityHit[] }).entities);
        }
        if (type === "box" && Array.isArray(data.boxes)) {
          const pg = typeof (data as { page?: unknown }).page === "number"
            ? (data as { page: number }).page : null;
          if (pg === null) setBoxes(data.boxes as Box[]);
          else {
            const list = data.boxes as Box[];
            setPageBoxes((p) => ({ ...p, [pg]: [...(p[pg] ?? []), ...list] }));
            if ((data as { cursor?: unknown }).cursor === true) setLivePage(pg);
          }
        }
        if (type === "page" && typeof (data as { page?: unknown }).page === "number") {
          setPage((data as { page: number }).page);
        }
        if (type === "status" || type === "page") {
          void refresh();
          const st = (data as { status?: unknown }).status;
          if (type === "status" && st === "done") void loadResultForRef.current(id);
        }
      });
    }
  }, [refresh]);

  // CPU explode (demo split): render PDF pages to JPEG data URLs at
  // ~150 dpi and post them to /pages. Mirrors snapshot() sizing.
  const explodePdf = async (buf: ArrayBuffer): Promise<string[]> => {
    const pdf = await pdfjs.getDocument({ data: buf.slice(0) }).promise;
    const out: string[] = [];
    const n = Math.min(pdf.numPages, 60);
    for (let i = 1; i <= n; i++) {
      const pg = await pdf.getPage(i);
      const vp = pg.getViewport({ scale: 150 / 72 });
      const c = document.createElement("canvas");
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      await pg.render({ canvas: c, viewport: vp }).promise;
      out.push(c.toDataURL("image/jpeg", 0.85));
    }
    return out;
  };

  const createJob = async () => {
    setErr("");
    try {
      const wantPdf = (pdfRef.current?.files?.length ?? 0) > 0;
      const job = await api.createJob(toolId, mode, wantPdf ? ["pending:upload"] : []);
      openJob(job.id);
      if (wantPdf && pdfRef.current?.files) {
        const buf = await pdfRef.current.files[0].arrayBuffer();
        if (toolId === "unlimited-ocr") {
          // Unlimited lane: no server-side PDF ingest — explode locally
          // and stream pages; the stage follows page events live.
          setPdfBuf(buf.slice(0));
          const pages = await explodePdf(buf);
          await api.postPages(job.id, pages);
        } else {
          await api.uploadPdf(job.id, buf);
        }
      }
      void refresh();
    } catch (e) { setErr(String((e as Error).message)); }
  };

  const goLive = async () => {
    setErr("");
    try {
      let id = sel;
      const current = jobs.find((j) => j.id === sel);
      if (!id || current?.mode !== "live") {
        const job = await api.createJob(toolId, "live", []);
        openJob(job.id);
        id = job.id;
        void refresh();
      }
      let s: MediaStream;
      try {
        s = await navigator.mediaDevices.getDisplayMedia({ video: true });
      } catch (e) {
        setErr(`screen share failed (${(e as Error).name}), trying camera…`);
        s = await navigator.mediaDevices.getUserMedia({ video: true });
      }
      setStream(s);
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        try { await videoRef.current.play(); }
        catch (e) { setErr(`video play failed: ${String((e as Error).message).slice(0, 120)}`); }
      }
      setAuto(true);
    } catch (e) { setErr(String((e as Error).message)); }
  };

  const stopLive = () => {
    stream?.getTracks().forEach((t) => t.stop());
    setStream(null);
    setAuto(false);
  };

  const snapshot = async () => {
    if (!sel || !stream || !videoRef.current) return;
    const v = videoRef.current;
    if (!v.videoWidth) { setErr("video has no frames yet — wait a second and retry"); return; }
    const s = Math.min(1, 960 / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(v.videoWidth * s); c.height = Math.round(v.videoHeight * s);
    c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);
    setImgSize({ w: c.width, h: c.height });
    const url = c.toDataURL("image/jpeg", 0.85);
    setFrameUrl(url);
    await api.postFrame(sel, url);
    setFramesSent((n) => n + 1);
  };

  const [auto, setAuto] = useState(false);
  const [framesSent, setFramesSent] = useState(0);
  const autoRef = useRef<number | null>(null);
  useEffect(() => {
    if (autoRef.current) { clearInterval(autoRef.current); autoRef.current = null; }
    if (auto && stream && sel) {
      autoRef.current = window.setInterval(() => { void snapshot(); }, 2000);
    }
    return () => { if (autoRef.current) { clearInterval(autoRef.current); autoRef.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, stream, sel]);

  const cur = jobs.find((j) => j.id === sel);
  const hasPdf = !!cur && (cur.input_refs.some((r) => r.endsWith(".pdf")) || pdfBuf !== null);

  const stepJob = (dir: 1 | -1) => {
    if (!jobs.length) return;
    const i = jobs.findIndex((j) => j.id === sel);
    const n = jobs[(i < 0 ? (dir > 0 ? -1 : 0) : i + dir + jobs.length) % jobs.length];
    if (n) openJob(n.id);
  };

  const loadResultFor = async (id: string, schema: string) => {
    try {
      const r = await api.result(id, schema);
      setResult(JSON.stringify(r, null, 2));
    } catch (e) { setErr(String((e as Error).message)); }
  };
  const loadResult = async () => { if (sel) await loadResultFor(sel, schemaId); };

  const downloadResult = () => {
    const blob = new Blob([result], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `result-${(sel ?? "job").slice(0, 8)}-${schemaId}.json`;
    a.click();
  };

  // Parsed result — only real engine output, no placeholders.
  let parsed: {
    fields: Record<string, { value: string; conf: number; page?: number; source?: string } | null>;
    missing_required: string[];
    tables: Array<{ page: number; rows: string[][] }>;
  } | null = null;
  try { parsed = result ? JSON.parse(result) : null; } catch { parsed = null; }
  const fieldEntries = parsed ? Object.entries(parsed.fields) : [];
  const tables = parsed?.tables ?? [];
  const miss = new Set(parsed?.missing_required ?? []);

  const saveAll = async () => {
    if (!sel || !parsed) return;
    for (const k of Object.keys(parsed.fields)) {
      const el = document.getElementById(`f-${k}`) as HTMLInputElement | null;
      if (el && el.value !== (parsed.fields[k]?.value ?? "")) await api.overrideField(sel, k, el.value);
    }
    await loadResult();
  };

  const lastEvent = events[0];

  // Graph: real boxes + entities of the selected job only.
  const allBoxes: Box[] = [...boxes, ...Object.values(pageBoxes).flat()];
  const maxX = Math.max(1, ...allBoxes.map((b) => b.x + b.w));
  const maxY = Math.max(1, ...allBoxes.map((b) => b.y + b.h));
  const pct = gpu ? Math.min(100, (gpu.used_gb / gpu.cap_gb) * 100) : 0;
  const kinds = [...new Set(allBoxes.map((b) => b.kind ?? "text"))];

  return (
    <div className="app">
      <header className="appheader">
        <div className="brand">Optic</div>
        <nav className="appnav">
          {(["review", "jobs", "graph"] as Route[]).map((r) => (
            <button key={r} className={route === r ? "on" : ""} onClick={() => setRoute(r)}>{r}</button>
          ))}
        </nav>
        <span className="gpu-mini">
          GPU {gpu ? `${gpu.used_gb}/${gpu.cap_gb} GB` : "…"} · {gpu?.loaded.join(", ") || "none loaded"}
          {stream && <> · live {framesSent}f</>}
        </span>
      </header>

        {route === "review" && (
          <div className="layout">
            <aside className="side">
              <h2>GPU · {gpu ? `${gpu.used_gb}/${gpu.cap_gb} GB` : "…"}</h2>
              <div className="vram"><div style={{ width: `${pct}%` }} /></div>
              <div className="muted">{gpu?.loaded.length ? `Loaded: ${gpu.loaded.join(", ")}` : "None loaded"}</div>
              <h2>Tools</h2>
              {tools.map((t) => (
                <div key={t.id} className={`tool${gpu?.loaded.includes(t.id) ? " active" : ""}`}>
                  <div className="name">{t.id}</div>
                  <div className="meta">{t.tier} · {t.vram_gb} GB · {t.backend}</div>
                  <div className="meta">{t.description}</div>
                  <button className="ghostbtn" onClick={() => { setToolId(t.id); api.loadTool(t.id).then(refresh).catch((e) => setErr(String(e.message))); }}>
                    {gpu?.loaded.includes(t.id) ? "Reload" : "Load"}
                  </button>
                </div>
              ))}
              <h2>Jobs ({jobs.length})</h2>
              {jobs.length === 0 && <p className="muted">No jobs yet.</p>}
              {jobs.map((j) => {
                const p = pillFor(j.status);
                return (
                  <div key={j.id} className={`jobrow${j.id === sel ? " sel" : ""}`} onClick={() => openJob(j.id)}>
                    <span className="monoid">{j.id.slice(0, 8)}</span>
                    <span className={p.cls}>{p.label}</span>
                    <span className="muted">{j.tool_id} · {j.mode}</span>
                  </div>
                );
              })}
              <h2>Latest event</h2>
              <div className="toolcall">{lastEvent ? `${lastEvent.type}: ${JSON.stringify(lastEvent.data).slice(0, 200)}` : "No events yet — open a job."}</div>
            </aside>
            <div className="maincol">
              <div className="bar">
                <select value={toolId} onChange={(e) => setToolId(e.target.value)}>
                  {tools.map((t) => <option key={t.id} value={t.id}>{t.id}</option>)}
                </select>
                <select value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="live">live</option>
                  <option value="batch">batch</option>
                </select>
                <input type="file" accept="application/pdf" ref={pdfRef} />
                <button className="postbtn" onClick={createJob}>New job</button>
                {!stream ? (
                  <button className="postbtn" onClick={goLive}>● Go live</button>
                ) : (
                  <button className="ghostbtn" onClick={stopLive}>■ Stop</button>
                )}
                <button className="ghostbtn" onClick={snapshot} disabled={!stream || !sel}>Capture frame</button>
                {stream
                  ? <span className="muted">live · {framesSent} frames{auto ? " · auto" : ""}</span>
                  : <span className="muted">Go live streams frames · or upload a PDF</span>}
                {cur && <span className="monoid">{cur.id.slice(0, 8)} · {cur.tool_id} · {cur.status}</span>}
                <button className="ghostbtn" onClick={() => stepJob(-1)} disabled={!jobs.length}>◀ Doc</button>
                <button className="ghostbtn" onClick={() => stepJob(1)} disabled={!jobs.length}>Doc ▶</button>
                <label className="sellabel">Schema
                <select value={schemaId} onChange={(e) => setSchemaId(e.target.value)}>
                  {schemas.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select></label>
                <button className="ghostbtn" onClick={loadResult} disabled={!sel}>Map fields</button>
                <button className="ghostbtn" onClick={downloadResult} disabled={!result}>JSON ⬇</button>
                {err && <span className="err">{err}</span>}
              </div>
              {kinds.length > 0 && (
                <div className="legend">
                  {kinds.map((k) => (
                    <span key={k}><i className="dot" style={{ background: colorFor(k) }} />{k}</span>
                  ))}
                </div>
              )}
              <div className="workspace">
                <div className="stage">
                  {cur?.mode === "batch" && hasPdf ? (<>
                    <PdfView jobId={cur.id} page={page} boxes={pageBoxes[page] ?? []} livePage={livePage} src={pdfBuf} />
                    <div className="pagenav">
                      <button onClick={() => setPage((p) => Math.max(1, p - 1))}>◀</button>
                      <span>p.{page}{livePage !== null && livePage !== page ? ` · live p.${livePage}` : ""}</span>
                      <button onClick={() => setPage((p) => p + 1)}>▶</button>
                    </div>
                  </>) : stream || frameUrl ? (<>
                    {stream
                      ? <video ref={videoRef} autoPlay muted playsInline />
                      : frameUrl && <img src={frameUrl} alt="last frame" />}
                    <canvas ref={overlayRef} className="liveover" />
                  </>) :
                    <div className="empty">Go live to stream frames, or upload a PDF for batch.</div>}
                </div>
                <div className="panels">
                  <div className="tabs">
                    {(["entities", "text", "tables", "events"] as const).map((t) => (
                      <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
                        {t[0].toUpperCase() + t.slice(1)}
                      </button>
                    ))}
                  </div>

                  {tab === "entities" && (
                    <div className="panel"><h3>Fields · {schemaId}</h3>
                      {!parsed && <span className="muted">{sel ? "Press Map fields to map this job to the schema." : "Create a job or upload a PDF, then press Map fields."}</span>}
                      {parsed && (<>
                        {miss.size > 0 && <p className="missingline">Missing required: {[...miss].join(", ")}</p>}
                        <div className="hgrid onecol">
                          {fieldEntries.map(([k, v]) => (
                            <label key={k} className={`fld${miss.has(k) && !v ? " is-missing" : ""}`}>
                              <span>✧ {k}</span>
                              <input id={`f-${k}`} defaultValue={v?.value ?? ""} placeholder={v ? undefined : "Missing — type value"} />
                              <em>{v ? `${v.conf.toFixed(2)}${v.page ? ` · p${v.page}` : ""}${v.source === "human" ? " · human" : ""}` : "missing"}</em>
                            </label>
                          ))}
                        </div>
                        <button className="postbtn" onClick={() => void saveAll()}>Save corrections</button>
                      </>)}
                    </div>
                  )}
                  {tab === "text" && <div className="panel"><h3>Markdown</h3><pre>{markdown || "—"}</pre></div>}
                  {tab === "tables" && (
                    <div className="panel"><h3>Tables</h3>
                      {!parsed && <span className="muted">Press Map fields, then open this tab.</span>}
                      {parsed && tables.length === 0 && <span className="muted">No tables detected.</span>}
                      {parsed && tables.map((t, i) => (
                        <details key={i} open={i === 0}>
                          <summary>table p{t.page} · {t.rows.length} rows · <button className="ghostbtn" onClick={(e) => { e.preventDefault(); dlCsv(i, t.rows); }}>CSV ⬇</button></summary>
                          <LineTable rows={t.rows} />
                        </details>
                      ))}
                    </div>
                  )}
                  {tab === "events" && (
                    <div className="panel"><h3>Fields JSON</h3><pre>{fields || "—"}</pre></div>
                  )}
                  {tab === "events" && (
                    <div className="panel log"><h3>Events</h3>
                      {events.length === 0 && <div className="muted">No events yet.</div>}
                      {events.map((e, i) => <div key={i}>{e.type}: {JSON.stringify(e.data).slice(0, 160)}</div>)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {route === "jobs" && (
          <div className="jobs">
            <div className="jobsmain">
              <h1>Jobs</h1>
              <div className="jobshead"><span>Status</span><span>Tool</span><span>Mode</span><span>Job ID</span><span>Created</span></div>
              {jobs.length === 0 && <p className="muted">No jobs yet — create one from the review view.</p>}
              {jobs.map((j) => {
                const p = pillFor(j.status);
                return (
                  <div className="jobsrow" key={j.id} onClick={() => { openJob(j.id); setRoute("review"); }}>
                    <span><span className={p.cls}>{p.label}</span></span>
                    <span>{j.tool_id}</span>
                    <span className="muted">{j.mode}</span>
                    <span className="monoid">{j.id.slice(0, 8)}</span>
                    <span className="muted">{j.created_at || "—"}</span>
                  </div>
                );
              })}
            </div>
            <aside className="activity">
              <h3>Events {cur ? `· ${cur.id.slice(0, 8)}` : ""}</h3>
              {events.length === 0 && <p className="muted">Select a job to see its event stream.</p>}
              {events.map((e, i) => <div key={i} className="act"><i className="live" />{e.type}: {JSON.stringify(e.data).slice(0, 60)}</div>)}
            </aside>
          </div>
        )}

        {route === "graph" && (
          <div className="graphwrap">
            <div className="graphhead">
              <h1>Entity graph</h1>
              <select value={sel ?? ""} onChange={(e) => openJob(e.target.value)} disabled={!jobs.length}>
                <option value="" disabled>{jobs.length ? "Select job" : "No jobs"}</option>
                {jobs.map((j) => <option key={j.id} value={j.id}>{j.id.slice(0, 8)} · {j.tool_id} · {j.status}</option>)}
              </select>
              {!entities.length && <span className="muted">Open a job and press Map fields to extract entities.</span>}
            </div>
            {entities.length > 0 && (
              <svg className="graph" viewBox="0 0 1000 560">
                {entities.map((e, i) => {
                  const y = 60 + (i * 460) / Math.max(1, entities.length - 1 || 1);
                  const matches = allBoxes.filter((b) => b.label === e.text || b.kind === e.kind);
                  return <g key={i}>
                    {matches.slice(0, 12).map((b, bi) => (
                      <line key={bi} x1={200} y1={y}
                        x2={260 + ((b.x + b.w / 2) / maxX) * 680}
                        y2={40 + ((b.y + b.h / 2) / maxY) * 480}
                        stroke={colorFor(b.kind)} strokeWidth="1" opacity="0.5" />
                    ))}
                    <circle cx={120} cy={y} r="9" fill="#a855f7" stroke="#fff" strokeWidth="2" />
                    <text x={140} y={y + 4} fontSize="12" fill="#333">{e.kind.replace(/^entity:/, "")}: {e.text.slice(0, 32)}</text>
                  </g>;
                })}
                {allBoxes.slice(0, 300).map((b, i) => (
                  <circle key={`b${i}`}
                    cx={260 + ((b.x + b.w / 2) / maxX) * 680}
                    cy={40 + ((b.y + b.h / 2) / maxY) * 480}
                    r={b.kind?.startsWith("entity:") ? 6 : 4}
                    fill={colorFor(b.kind)} stroke="#fff" strokeWidth="1.5" />
                ))}
              </svg>
            )}
          </div>
        )}
    </div>
  );
}

const csvOf = (rows: string[][]): string =>
  rows.map((row) => row.map((c) => `"${(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");

const dlCsv = (i: number, rows: string[][]) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csvOf(rows)], { type: "text/csv" }));
  a.download = `table-${i}.csv`;
  a.click();
};

function LineTable({ rows }: { rows: string[][] }) {
  if (rows.length < 2) return <p className="muted">No tables detected — upload a batch PDF, then press Map fields.</p>;
  const [head, ...body] = rows;
  return (
    <div className="linetable">
      <div className="lt-row lt-head" style={{ gridTemplateColumns: `repeat(${head.length}, 1fr)` }}>
        {head.map((c, i) => <span key={i}>{c || `Col ${i + 1}`}</span>)}
      </div>
      {body.slice(0, 10).map((r, i) => (
        <div className="lt-row" key={i} style={{ gridTemplateColumns: `repeat(${head.length}, 1fr)` }}>
          {head.map((_, ci) => <span key={ci}>{r[ci] || "—"}</span>)}
        </div>
      ))}
      {body.length > 10 && <p className="muted">…{body.length - 10} more rows in JSON.</p>}
    </div>
  );
}
