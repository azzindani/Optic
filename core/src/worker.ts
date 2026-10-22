// Worker: drains batch/live queues, calls the loaded tool sidecar over
// HTTP, appends box/markdown/fields events. No fake results: when the
// sidecar is unreachable the job goes to error with an actionable note.
// TurboOCR speaks POST {base}/ocr/raw (raw image bytes); generic VLM
// sidecars speak POST {base}/infer (JSON). URLs come from env.
import type { Queue } from "./queue.js";
import type { Store } from "./store.js";
import { gpuStatus } from "./gpu.js";
import { registry } from "./tools.js";
import type { Box, Entity } from "./types.js";
import { extractEntities, type Word } from "./entities.js";
import { htmlTableToRows, type TableData } from "./tables.js";

export interface SidecarResult {
  boxes?: Box[];
  words?: Word[];
  text?: string;
  fields?: unknown;
  entities?: Entity[];
  tables?: TableData[];
}

// Per-tool sidecar routing. Each lane has its own env so segment and yolo
// (or any future generic sidecars) co-serve through one gateway without
// restarts. GENERIC_SIDECAR_URL stays the fallback for unmapped tools.
const TOOL_URL_ENV: Record<string, string> = {
  "unlimited-ocr": "UNLIMITED_URL",
  "segment-tiny": "SEGMENT_URL",
  "yolo-live": "YOLO_URL",
};

export function sidecarBase(toolId: string): string | null {
  if (toolId.startsWith("turbo")) return process.env.TURBO_URL ?? null;
  const name = TOOL_URL_ENV[toolId] ?? "GENERIC_SIDECAR_URL";
  return process.env[name] ?? null;
}

export function sidecarHint(toolId: string): string {
  if (toolId.startsWith("turbo")) {
    return "Set TURBO_URL to a running OCR sidecar (tools/turbo-tiny server or TurboOCR Docker).";
  }
  const name = TOOL_URL_ENV[toolId] ?? "GENERIC_SIDECAR_URL";
  return `Set ${name} to the running ${toolId} sidecar.`;
}

type Quad = [[number, number], [number, number], [number, number], [number, number]];

function quadToRect(quad: Quad): { x: number; y: number; w: number; h: number } {
  const xs = quad.map((p) => p[0]);
  const ys = quad.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

async function callTurbo(base: string, image: Buffer, tables = false): Promise<SidecarResult> {
  const res = await fetch(`${base}/ocr/raw?layout=1${tables ? "&tables=1" : ""}`, {
    method: "POST",
    headers: { "content-type": "image/jpeg" },
    body: new Uint8Array(image),
  });
  if (!res.ok) throw new Error(`turbo ${res.status}`);
  const body = (await res.json()) as Record<string, unknown>;
  // Real shape: { results: [{ text, confidence, bounding_box: quad }],
  //   layout: [{ class, confidence, bounding_box }] }.
  if (Array.isArray(body.results)) {
    const results = body.results as Array<{
      text?: unknown; confidence?: unknown; bounding_box?: unknown;
    }>;
    const words: Word[] = [];
    const textParts: string[] = [];
    for (const r of results) {
      if (typeof r.text !== "string" || !r.text) continue;
      const rect = quadToRect(r.bounding_box as Quad);
      const conf = typeof r.confidence === "number" ? r.confidence : 0;
      words.push({ text: r.text, box: rect, conf });
      textParts.push(r.text);
    }
    const boxes: Box[] = words.map((w) => ({ ...w.box, kind: "text", conf: w.conf }));
    if (Array.isArray(body.layout)) {
      for (const l of body.layout as Array<{ class?: unknown; confidence?: unknown; bounding_box?: unknown }>) {
        if (typeof l.class !== "string" || !Array.isArray(l.bounding_box)) continue;
        const rect = quadToRect(l.bounding_box as Quad);
        boxes.push({
          ...rect,
          kind: `layout:${l.class}`,
          label: l.class,
          conf: typeof l.confidence === "number" ? l.confidence : 0,
        });
      }
    }
    const entities = extractEntities(words);
    for (const e of entities) boxes.push(e.box);
    const parsed: TableData[] = [];
    const rawTables = (body as Record<string, unknown>).tables;
    if (tables && Array.isArray(rawTables)) {
      for (const t of rawTables as Array<{ html?: unknown }>) {
        if (t && typeof t.html === "string") {
          const rows = htmlTableToRows(t.html);
          if (rows.rows.length) parsed.push(rows);
        }
      }
    }
    return {
      text: textParts.join("\n"),
      words,
      boxes,
      entities,
      tables: parsed,
      fields: {
        _method: "pattern-ner v1 over turbo words",
        entities: entities.map((e) => ({ kind: e.kind, label: e.label, text: e.text, conf: e.conf })),
      },
    };
  }
  // Legacy fallback: { text, boxes } already in rect form.
  return {
    text: typeof body.text === "string" ? body.text : JSON.stringify(body).slice(0, 4000),
    boxes: Array.isArray(body.boxes) ? (body.boxes as SidecarResult["boxes"]) : [],
  };
}

async function callGeneric(base: string, image: Buffer): Promise<SidecarResult> {
  const res = await fetch(`${base}/infer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ image_b64: image.toString("base64") }),
  });
  if (!res.ok) throw new Error(`sidecar ${res.status}`);
  return (await res.json()) as SidecarResult;
}

// Latest frame per live job. Frames are ephemeral; jobs are durable.
export const pendingFrames = new Map<string, Buffer>();

// Batch jobs waiting for PDF bytes (input_refs ["pending:upload"]) stay
// queued until the upload lands; capped so orphans error out (~60 s).
const pendingAttempts = new Map<string, number>();

export async function processNext(queue: Queue, store: Store): Promise<boolean> {
  const next = queue.dequeue();
  if (!next) return false;
  const job = store.getJob(next.jobId);
  if (!job || job.status !== "queued") return true;
  if (job.mode === "batch" && job.input_refs.includes("pending:upload")) {
    const n = (pendingAttempts.get(job.id) ?? 0) + 1;
    if (n > 600) {
      pendingAttempts.delete(job.id);
      store.updateJob(job.id, { status: "error", error: "no pdf uploaded within 5m" });
      store.appendEvent(job.id, "status", { status: "error", reason: "no-input" });
      return true;
    }
    pendingAttempts.set(job.id, n);
    queue.enqueue("batch", job.id);
    return true;
  }
  pendingAttempts.delete(next.jobId);
  if (job.tool_id === "unlimited-ocr") {
    // Unlimited-ocr jobs are driven synchronously by POST /pages (batch)
    // or unsupported (live). Never claim them here; batch jobs wait for
    // their pages the same way uploads wait for PDF bytes.
    if (job.mode === "live") {
      store.updateJob(job.id, { status: "error", error: "unlimited-ocr supports batch+pages, not live frames" });
      return true;
    }
    const n = (pendingAttempts.get(job.id) ?? 0) + 1;
    if (n > 600) {
      pendingAttempts.delete(job.id);
      store.updateJob(job.id, { status: "error", error: "no pages posted within 5m" });
      store.appendEvent(job.id, "status", { status: "error", reason: "no-input" });
      return true;
    }
    pendingAttempts.set(job.id, n);
    queue.enqueue("batch", job.id);
    return true;
  }
  const image = pendingFrames.get(job.id) ?? Buffer.alloc(0);
  if (job.mode === "live" && image.length === 0) {
    // Live jobs wait for their first frame instead of erroring.
    const n = (pendingAttempts.get(job.id) ?? 0) + 1;
    if (n > 600) {
      pendingAttempts.delete(job.id);
      store.updateJob(job.id, { status: "error", error: "no frame received within 5m" });
      store.appendEvent(job.id, "status", { status: "error", reason: "no-input" });
      return true;
    }
    pendingAttempts.set(job.id, n);
    queue.enqueue("live", job.id);
    return true;
  }
  const manifest = registry.get(job.tool_id);
  if (!manifest) {
    store.updateJob(job.id, { status: "error", error: `unknown tool ${job.tool_id}` });
    return true;
  }
  if (!gpuStatus().loaded.includes(job.tool_id)) {
    store.updateJob(job.id, {
      status: "error",
      error: `tool ${job.tool_id} not loaded. POST /v1/tools/${job.tool_id}/load first.`,
    });
    store.appendEvent(job.id, "status", { status: "error", reason: "tool-not-loaded" });
    return true;
  }
  const base = sidecarBase(job.tool_id);
  if (!base) {
    const hint = sidecarHint(job.tool_id);
    store.updateJob(job.id, { status: "error", error: `sidecar offline. ${hint}` });
    store.appendEvent(job.id, "status", { status: "error", reason: "sidecar-offline" });
    return true;
  }
  try {
    store.updateJob(job.id, { status: "active" });
    const out = manifest.backend === "tensorrt"
      ? await callTurbo(base, image, job.options?.tables === true)
      : await callGeneric(base, image);
    if (out.boxes?.length) store.appendEvent(job.id, "box", { boxes: out.boxes });
    if (out.text) store.appendEvent(job.id, "markdown", { text: out.text });
    if (out.fields) store.appendEvent(job.id, "fields", out.fields);
    if (out.tables?.length) store.appendEvent(job.id, "tables", { tables: out.tables });
    // Batch jobs finish; live jobs stay active for more frames.
    if (job.mode === "batch") store.updateJob(job.id, { status: "done" });
    else store.appendEvent(job.id, "status", { status: "active", note: "frame processed" });
  } catch (err) {
    store.updateJob(job.id, { status: "error", error: `sidecar call failed: ${(err as Error).message}` });
    store.appendEvent(job.id, "status", { status: "error", reason: "sidecar-call-failed" });
  }
  return true;
}

export function startWorker(queue: Queue, store: Store, ms = 500): () => void {
  if (process.env.WORKER === "0") return () => {};
  const t = setInterval(() => {
    processNext(queue, store).catch(() => {});
  }, ms);
  (t as unknown as { unref(): void }).unref?.();
  return () => clearInterval(t);
}
