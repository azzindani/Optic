// Queue behind an interface. v1 is in-process; Redis/NATS later
// implement the same surface without touching routes.

export interface QueueStats {
  batch: number;
  live: number;
}

export interface Queue {
  enqueue(queue: "batch" | "live", jobId: string): void;
  dequeue(): { queue: "batch" | "live"; jobId: string } | null;
  stats(): QueueStats;
}

export function createMemoryQueue(): Queue {
  const batch: string[] = [];
  const live: string[] = [];
  return {
    enqueue(queue, jobId) {
      // Live preempts batch at dequeue time; both stay queued here.
      (queue === "live" ? live : batch).push(jobId);
    },
    dequeue() {
      const nextLive = live.shift();
      if (nextLive) return { queue: "live", jobId: nextLive };
      const nextBatch = batch.shift();
      if (nextBatch) return { queue: "batch", jobId: nextBatch };
      return null;
    },
    stats() {
      return { batch: batch.length, live: live.length };
    },
  };
}
