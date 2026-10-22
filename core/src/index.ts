import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Job } from "./types.js";
import { createMemoryQueue } from "./queue.js";
import { createSqliteStore } from "./storeSqlite.js";
import { gpuStatus, loadTool, unloadTool } from "./gpu.js";
import { registry } from "./tools.js";
import { streamJobEvents } from "./sse.js";
import { diffBoxes, parseDet } from "./det.js";
import { streamChat, unlimitedBase } from "./unlimited.js";
import { pendingFrames, startWorker } from "./worker.js";
import { assembleResult } from "./result.js";
import { SCHEMAS } from "./schemas.js";

const app = Fastify({ logger: true });
await app.register(cors);

// Serve the built web UI when present (vite build output).
const webRoot = join(process.cwd(), "web", "dist");
if (existsSync(join(webRoot, "index.html"))) {
  await app.register(fastifyStatic, { root: webRoot });
}

// Raw PDF bytes for the ingestion route (50 MB cap, Turbo allows 100).
app.addContentTypeParser("application/pdf", { parseAs: "buffer", bodyLimit: 50 * 1024 * 1024 }, (_req, body, done) => {
  done(null, body);
});

const queue = createMemoryQueue();
const store = createSqliteStore(process.env.DATA_PATH ?? "data/jobs.db");
// Requeue durable queued jobs after a restart.
for (const j of store.listJobs().filter((x) => x.status === "queued").reverse()) {
  queue.enqueue(j.mode === "live" ? "live" : "batch", j.id);
}
const now = () => new Date().toISOString();

function requireAuth(req: unknown, reply: { code(n: number): unknown }): boolean {
  // v1 single-user: permissive hook. Enterprise checks JWT here.
  void req;
  void reply;
  return true;
}

app.get("/v1/health", async () => ({ ok: true }));

app.get("/v1/tools", async () => [...registry.values()]);

app.get("/v1/schemas", async () => SCHEMAS);

app.get("/v1/jobs/:id/result", async (req, reply) => {
  const { id } = req.params as { id: string };
  const job = store.getJob(id);
  if (!job) return reply.code(404).send({ error: "unknown job" });
  const schema = (req.query as Record<string, string> | undefined)?.schema;
  if (schema && !SCHEMAS.find((s) => s.id === schema)) {
    return reply.code(400).send({ error: "unknown schema. See GET /v1/schemas" });
  }
  return assembleResult(store, job, schema);
});

// Human field override: latest wins in the result assembler, source=human.
app.post("/v1/jobs/:id/fields", async (req, reply) => {
  const { id } = req.params as { id: string };
  const job = store.getJob(id);
  if (!job) return reply.code(404).send({ error: "unknown job" });
  const body = (req.body ?? {}) as { key?: unknown; value?: unknown };
  if (typeof body.key !== "string" || !body.key || typeof body.value !== "string") {
    return reply.code(400).send({ error: "body needs {key, value} strings" });
  }
  store.appendEvent(id, "fields", {
    override: { key: body.key, value: body.value, by: "human", at: now() },
  });
  return { ok: true };
});

// Serve the stored input PDF so the viewer can render pages locally.
app.get("/v1/jobs/:id/input", async (req, reply) => {
  const { id } = req.params as { id: string };
  const job = store.getJob(id);
  const ref = job?.input_refs.find((r) => r.endsWith(".pdf"));
  if (!ref || !existsSync(ref)) return reply.code(404).send({ error: "no stored pdf" });
  return reply
    .header("content-type", "application/pdf")
    .send(readFileSync(ref));
});

app.post("/v1/tools/:id/load", async (req, reply) => {
  if (!requireAuth(req, reply)) return reply.code(401).send({ error: "unauthorized" });
  const { id } = req.params as { id: string };
  const res = loadTool(id);
  if (!res.ok) return reply.code(409).send({ error: res.error, gpu: gpuStatus() });
  return { ok: true, gpu: gpuStatus() };
});

app.post("/v1/tools/:id/unload", async (req) => {
  const { id } = req.params as { id: string };
  unloadTool(id);
  return { ok: true, gpu: gpuStatus() };
});

app.get("/v1/gpu", async () => gpuStatus());

app.post("/v1/jobs", async (req, reply) => {
  if (!requireAuth(req, reply)) return reply.code(401).send({ error: "unauthorized" });
  const body = (req.body ?? {}) as Partial<Job> & { files?: string[] };
  if (!body.tool_id || !registry.has(body.tool_id)) {
    return reply.code(400).send({ error: "unknown tool_id. See GET /v1/tools" });
  }
  const job: Job = {
    id: randomUUID(),
    owner_id: "local",
    tool_id: body.tool_id,
    mode: body.mode === "live" ? "live" : "batch",
    status: "queued",
    input_refs: body.input_refs ?? body.files ?? [],
    artifact_refs: [],
    error: null,
    idempotency_key: (req.headers["idempotency-key"] as string) ?? null,
    options: body.options?.tables ? { tables: true } : undefined,
    created_at: now(),
    updated_at: now(),
  };
  store.createJob(job);
  queue.enqueue(job.mode === "live" ? "live" : "batch", job.id);
  store.appendEvent(job.id, "status", { status: job.status, tool_id: job.tool_id });
  return reply.code(201).send(job);
});

app.get("/v1/jobs", async () => store.listJobs());

app.get("/v1/jobs/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const job = store.getJob(id);
  if (!job) return reply.code(404).send({ error: "unknown job" });
  return job;
});

// Live tail: SSE with Last-Event-ID replay. Scales behind any gateway.
app.get("/v1/jobs/:id/events", (req, reply) =>
  streamJobEvents(req as never, reply as never, store),
);

// Upstream frames from screen share. Stateless POST keeps routing simple.
// Latest JPEG per job is kept in memory for the worker; jobs stay durable.
app.post("/v1/jobs/:id/frames", async (req, reply) => {
  const { id } = req.params as { id: string };
  const job = store.getJob(id);
  if (!job) return reply.code(404).send({ error: "unknown job" });
  const body = (req.body ?? {}) as { jpeg?: string };
  if (typeof body.jpeg === "string") {
    const b64 = body.jpeg.includes(",") ? body.jpeg.split(",")[1] : body.jpeg;
    try {
      pendingFrames.set(id, Buffer.from(b64, "base64"));
    } catch {
      // Keep the job alive even for a bad frame.
    }
  }
  store.appendEvent(id, "page", { received_at: now(), note: "frame accepted" });
  // Live jobs re-arm on every frame so the worker keeps processing the
  // stream; batch jobs are untouched.
  if (job.mode === "live" && job.status === "active") {
    store.updateJob(id, { status: "queued" });
    queue.enqueue("live", id);
  }
  return { ok: true };
});

app.post("/v1/jobs/:id/corrections", async (req, reply) => {
  const { id } = req.params as { id: string };
  const job = store.getJob(id);
  if (!job) return reply.code(404).send({ error: "unknown job" });
  store.appendEvent(id, "box", { received_at: now(), body: req.body ?? {} });
  return { ok: true };
});

// PDF ingestion: raw bytes in, per-page markdown events out via TurboOCR
// native /ocr/pdf. Client creates the job first with input_refs
// ["pending:upload"] so the worker leaves it alone until bytes land.
app.post("/v1/jobs/:id/pdf", async (req, reply) => {
  const { id } = req.params as { id: string };
  const job = store.getJob(id);
  if (!job) return reply.code(404).send({ error: "unknown job" });
  if (job.status !== "queued") return reply.code(409).send({ error: `job is ${job.status}` });
  if (!job.tool_id.startsWith("turbo")) {
    return reply.code(400).send({ error: "pdf ingestion needs a turbo tool" });
  }
  if (!gpuStatus().loaded.includes(job.tool_id)) {
    return reply.code(409).send({ error: `tool ${job.tool_id} not loaded` });
  }
  const base = process.env.TURBO_URL;
  if (!base) return reply.code(409).send({ error: "sidecar offline. Set TURBO_URL." });
  const pdf = req.body as Buffer;
  if (!Buffer.isBuffer(pdf) || pdf.length < 4 || pdf.subarray(0, 4).toString() !== "%PDF") {
    return reply.code(400).send({ error: "body must be raw PDF bytes" });
  }
  const dataPath = process.env.DATA_PATH ?? "data/jobs.db";
  const inputDir = process.env.INPUT_DIR ?? join(dirname(dataPath), "inputs");
  mkdirSync(inputDir, { recursive: true });
  const rel = join(inputDir, `${id}.pdf`);
  writeFileSync(rel, pdf);
  store.updateJob(id, { status: "active", input_refs: [rel] });
  try {
    const res = await fetch(`${base}/ocr/pdf?markdown=1`, {
      method: "POST",
      headers: { "content-type": "application/pdf" },
      body: new Uint8Array(pdf),
    });
    if (!res.ok) throw new Error(`turbo pdf ${res.status}`);
    let md = await res.text();
    // TurboOCR embeds page/region renders as base64 data URLs. Those bloat
    // the event log (a cover page was 766 KB), so replace with placeholders.
    // Raw pages stay available from the stored input PDF.
    const embedded = md.match(/!\[[^\]]*\]\(data:image\/[^)]+\)/g) ?? [];
    md = md.replace(/!\[[^\]]*\]\(data:image\/[^)]+\)/g, "[page-image]");
    const pages = md.split(/<!-- page (\d+) -->/).slice(1);
    for (let i = 0; i < pages.length; i += 2) {
      const n = Number(pages[i]);
      const text = (pages[i + 1] ?? "").trim();
      store.appendEvent(id, "page", { page: n });
      if (text) store.appendEvent(id, "markdown", { page: n, text });
    }
    store.updateJob(id, { status: "done", artifact_refs: [rel] });
    store.appendEvent(id, "status", { status: "done" });
    let entityCount = 0;
    // Opt-in second pass: structured words -> grounded entities (+tables).
    const wantEntities = (req.query as Record<string, string> | undefined)?.entities === "1";
    const wantTables = (req.query as Record<string, string> | undefined)?.tables === "1";
    if (wantEntities || wantTables) {
      try {
        const res2 = await fetch(`${base}/ocr/pdf${wantTables ? "?tables=1" : ""}`, {
          method: "POST",
          headers: { "content-type": "application/pdf" },
          body: new Uint8Array(pdf),
        });
        if (res2.ok) {
          const structured = (await res2.json()) as {
            pages?: Array<{ page?: number; tables?: Array<{ html?: unknown }>; results?: Array<{
              text?: unknown; confidence?: unknown;
              bounding_box?: [[number, number], [number, number], [number, number], [number, number]];
            }> }>;
          };
          const { extractEntities } = await import("./entities.js");
          const { htmlTableToRows } = await import("./tables.js");
          for (const pg of structured.pages ?? []) {
            if (wantTables && Array.isArray(pg.tables)) {
              const tables = [];
              for (const t of pg.tables) {
                if (t && typeof t.html === "string") {
                  const parsed = htmlTableToRows(t.html);
                  if (parsed.rows.length) tables.push(parsed);
                }
              }
              if (tables.length) {
                store.appendEvent(id, "tables", { page: pg.page ?? 0, tables });
              }
            }
            if (!wantEntities) continue;
            const words = (pg.results ?? [])
              .filter((r) => typeof r.text === "string" && r.text && Array.isArray(r.bounding_box))
              .map((r) => {
                const q = r.bounding_box as [[number, number], [number, number], [number, number], [number, number]];
                const xs = q.map((p) => p[0]);
                const ys = q.map((p) => p[1]);
                const x = Math.min(...xs);
                const y = Math.min(...ys);
                return {
                  text: r.text as string,
                  box: {
                    x, y,
                    w: Math.max(...xs) - x,
                    h: Math.max(...ys) - y,
                  },
                  conf: typeof r.confidence === "number" ? r.confidence : 0,
                };
              });
            const entities = extractEntities(words);
            if (entities.length) {
              entityCount += entities.length;
              store.appendEvent(id, "box", {
                page: pg.page ?? 0,
                boxes: entities.map((e) => e.box),
              });
              store.appendEvent(id, "fields", {
                page: pg.page ?? 0,
                _method: "pattern-ner v1 over turbo words",
                entities: entities.map((e) => ({ kind: e.kind, label: e.label, text: e.text, conf: e.conf })),
              });
            }
          }
        }
      } catch {
        // Entities are best-effort; markdown already landed.
      }
    }
    return { ok: true, pages: pages.length / 2, stripped_images: embedded.length, entities: entityCount };
  } catch (err) {
    store.updateJob(id, { status: "error", error: `pdf ingest failed: ${(err as Error).message}` });
    store.appendEvent(id, "status", { status: "error", reason: "pdf-ingest-failed" });
    return reply.code(502).send({ error: "pdf ingest failed" });
  }
});

// Page-image ingestion for the unlimited-ocr lane: the client explodes the
// PDF to PNGs (pdfjs, CPU — same split as the baidu demo) and posts them
// here. Each page streams through :8003 with stream:true; det grounding
// tokens become `box` events in reading order (the live cursor) and each
// page closes with a `markdown` event. Body cap covers ~40 pages at 150dpi.
app.post("/v1/jobs/:id/pages", { bodyLimit: 50 * 1024 * 1024 }, async (req, reply) => {
  const { id } = req.params as { id: string };
  const job = store.getJob(id);
  if (!job) return reply.code(404).send({ error: "unknown job" });
  if (job.status !== "queued") return reply.code(409).send({ error: `job is ${job.status}` });
  if (job.tool_id !== "unlimited-ocr") {
    return reply.code(400).send({ error: "page ingestion needs the unlimited-ocr tool" });
  }
  if (!gpuStatus().loaded.includes(job.tool_id)) {
    return reply.code(409).send({ error: `tool ${job.tool_id} not loaded` });
  }
  const base = unlimitedBase();
  if (!base) return reply.code(409).send({ error: "sidecar offline. Set UNLIMITED_URL." });
  const body = (req.body ?? {}) as { pages?: unknown };
  if (!Array.isArray(body.pages) || body.pages.length === 0 || body.pages.length > 60) {
    return reply.code(400).send({ error: "body.pages must be 1-60 image data URLs" });
  }
  const pages = body.pages.filter((p): p is string => typeof p === "string" && p.length > 100);
  if (!pages.length) return reply.code(400).send({ error: "no usable page images" });
  store.updateJob(id, { status: "active" });
  let boxCount = 0;
  try {
    for (let i = 0; i < pages.length; i++) {
      const n = i + 1;
      store.appendEvent(id, "page", { page: n, of: pages.length });
      let seen = 0;
      const raw = await streamChat(base, [pages[i]], (acc) => {
        const d = diffBoxes(seen, acc);
        seen = d.total;
        if (d.boxes.length) {
          store.appendEvent(id, "box", { page: n, boxes: d.boxes, cursor: true });
        }
      });
      const { boxes, markdown } = parseDet(raw);
      boxCount += boxes.length;
      if (markdown.trim()) store.appendEvent(id, "markdown", { page: n, text: markdown });
    }
    store.updateJob(id, { status: "done" });
    store.appendEvent(id, "status", { status: "done" });
    return { ok: true, pages: pages.length, boxes: boxCount };
  } catch (err) {
    store.updateJob(id, { status: "error", error: `pages ingest failed: ${(err as Error).message}` });
    store.appendEvent(id, "status", { status: "error", reason: "pages-ingest-failed" });
    return reply.code(502).send({ error: "pages ingest failed" });
  }
});

const port = Number(process.env.PORT ?? 3000);
startWorker(queue, store);
app.listen({ port, host: "127.0.0.1" });
