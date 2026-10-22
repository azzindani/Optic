// Payload-ready result JSON: one stable shape per job for ERP/ops
// systems. Assembled purely from the persisted event log.
import type { Store } from "./store.js";
import type { Job } from "./types.js";
import { mapToSchema, missingRequired, SCHEMAS } from "./schemas.js";

export interface ResultPayload {
  job_id: string;
  tool_id: string;
  status: string;
  schema: string | null;
  fields: Record<string, { value: string; conf: number; page?: number; source: "model" | "human" } | null>;
  missing_required: string[];
  tables: Array<{ page: number; rows: string[][] }>;
  markdown_chars: number;
  boxes: number;
  error: string | null;
}

export function assembleResult(store: Store, job: Job, schemaId?: string): ResultPayload {
  const events = store.eventsAfter(job.id, 0);
  const schema = SCHEMAS.find((s) => s.id === schemaId) ?? null;
  const flat: Array<{ kind: string; text: string; conf: number; page?: number }> = [];
  const tables: ResultPayload["tables"] = [];
  let markdown_chars = 0;
  let boxes = 0;
  for (const ev of events) {
    const d = ev.data as Record<string, unknown>;
    if (ev.type === "markdown" && typeof d.text === "string") markdown_chars += d.text.length;
    if (ev.type === "box" && Array.isArray(d.boxes)) boxes += (d.boxes as unknown[]).length;
    if (ev.type === "fields" && Array.isArray(d.entities)) {
      const page = typeof d.page === "number" ? d.page : undefined;
      for (const e of d.entities as Array<{ kind: string; text: string; conf: number }>) {
        flat.push({ kind: e.kind, text: e.text, conf: e.conf, page });
      }
    }
    if (ev.type === "tables" && Array.isArray(d.tables)) {
      const page = typeof d.page === "number" ? d.page : 0;
      for (const t of d.tables as Array<{ rows: string[][] }>) {
        tables.push({ page, rows: t.rows });
      }
    }
  }
  const fields = schema ? mapToSchema(schema, flat) : {};
  const withSource: ResultPayload["fields"] = {};
  for (const [k, v] of Object.entries(fields)) {
    withSource[k] = v ? { ...v, source: "model" as const } : null;
  }
  // Human overrides win (latest event wins), preserving provenance.
  for (const ev of events) {
    if (ev.type !== "fields") continue;
    const d = ev.data as { override?: { key?: unknown; value?: unknown } };
    if (d.override && typeof d.override.key === "string" && typeof d.override.value === "string") {
      withSource[d.override.key] = { value: d.override.value, conf: 1, source: "human" as const };
    }
  }
  return {
    job_id: job.id,
    tool_id: job.tool_id,
    status: job.status,
    schema: schema?.id ?? null,
    fields: withSource,
    missing_required: schema ? missingRequired(schema, withSource) : [],
    tables,
    markdown_chars,
    boxes,
    error: job.error,
  };
}
