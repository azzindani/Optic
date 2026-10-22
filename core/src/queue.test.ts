import { describe, expect, it } from "vitest";
import { createMemoryQueue } from "./queue.js";

describe("queue", () => {
  it("live preempts batch", () => {
    const q = createMemoryQueue();
    q.enqueue("batch", "b1");
    q.enqueue("live", "l1");
    q.enqueue("batch", "b2");
    expect(q.dequeue()).toEqual({ queue: "live", jobId: "l1" });
    expect(q.dequeue()).toEqual({ queue: "batch", jobId: "b1" });
    expect(q.dequeue()).toEqual({ queue: "batch", jobId: "b2" });
    expect(q.dequeue()).toBeNull();
  });

  it("tracks depth", () => {
    const q = createMemoryQueue();
    q.enqueue("batch", "b1");
    q.enqueue("batch", "b2");
    q.enqueue("live", "l1");
    expect(q.stats()).toEqual({ batch: 2, live: 1 });
  });
});
