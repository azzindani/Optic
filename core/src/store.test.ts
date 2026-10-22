import { describe, expect, it } from "vitest";
import { createMemoryStore } from "./store.js";
import type { Job } from "./types.js";

function job(id: string): Job {
  const t = new Date().toISOString();
  return {
    id,
    owner_id: "local",
    tool_id: "turbo-tiny",
    mode: "batch",
    status: "queued",
    input_refs: [],
    artifact_refs: [],
    error: null,
    idempotency_key: null,
    created_at: t,
    updated_at: t,
  };
}

describe("store", () => {
  it("creates, gets, updates jobs", () => {
    const s = createMemoryStore();
    s.createJob(job("a"));
    expect(s.getJob("a")?.status).toBe("queued");
    expect(s.getJob("missing")).toBeNull();
    s.updateJob("a", { status: "done" });
    expect(s.getJob("a")?.status).toBe("done");
    expect(s.updateJob("missing", { status: "done" })).toBeNull();
  });

  it("appends events and replays after seq", () => {
    const s = createMemoryStore();
    s.createJob(job("a"));
    const e1 = s.appendEvent("a", "status", { status: "queued" });
    const e2 = s.appendEvent("a", "markdown", { page: 1 });
    expect(e2.seq).toBeGreaterThan(e1.seq);
    expect(s.eventsAfter("a", 0)).toHaveLength(2);
    expect(s.eventsAfter("a", e1.seq)).toEqual([e2]);
    expect(s.eventsAfter("missing", 0)).toEqual([]);
  });
});
