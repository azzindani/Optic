import { describe, expect, it } from "vitest";
import { createMemoryStore } from "./store.js";
import { assembleResult } from "./result.js";
import type { Job } from "./types.js";

function job(): Job {
  const t = new Date().toISOString();
  return {
    id: "r1", owner_id: "local", tool_id: "turbo-tiny", mode: "batch",
    status: "done", input_refs: [], artifact_refs: [], error: null,
    idempotency_key: null, created_at: t, updated_at: t,
  };
}

describe("result", () => {
  it("maps entities, honors human overrides, flags missing", () => {
    const s = createMemoryStore();
    s.createJob(job());
    s.appendEvent("r1", "fields", {
      entities: [
        { kind: "entity:invoice_no", text: "INV-1", conf: 0.9 },
        { kind: "entity:amount", text: "10.00", conf: 0.8 },
      ],
    });
    let r = assembleResult(s, s.getJob("r1")!, "invoice");
    expect(r.fields.invoice_no?.value).toBe("INV-1");
    expect(r.fields.invoice_no?.source).toBe("model");
    expect(r.missing_required).toContain("date");

    s.appendEvent("r1", "fields", { override: { key: "date", value: "2026-01-02", by: "human" } });
    r = assembleResult(s, s.getJob("r1")!, "invoice");
    expect(r.fields.date?.value).toBe("2026-01-02");
    expect(r.fields.date?.source).toBe("human");
    expect(r.missing_required).not.toContain("date");

    // Latest override wins.
    s.appendEvent("r1", "fields", { override: { key: "date", value: "2026-05-06", by: "human" } });
    r = assembleResult(s, s.getJob("r1")!, "invoice");
    expect(r.fields.date?.value).toBe("2026-05-06");
  });

  it("collects tables and counts content", () => {
    const s = createMemoryStore();
    s.createJob(job());
    s.appendEvent("r1", "markdown", { text: "hello" });
    s.appendEvent("r1", "tables", { page: 1, tables: [{ rows: [["a", "b"]] }] });
    const r = assembleResult(s, s.getJob("r1")!, "invoice");
    expect(r.tables).toEqual([{ page: 1, rows: [["a", "b"]] }]);
    expect(r.markdown_chars).toBe(5);
  });
});
