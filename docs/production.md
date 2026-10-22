# Production (single-user)

Production-grade here means reliable on one machine, not high RPS.

## Must-haves
- Durable jobs: create is transactional. Crash restarts resume queued
  jobs, mark GPU-leased job as interrupted with retry.
- VRAM guard: refuse load when `used + needed > 7 GB`. Clear error
  with current holder and one-click unload.
- Model switch: drain GPU lease, stop backend, free cache,
  load next, warmup one page, then resume queue.
- Offline: works after first model and engine download.
- Logs: daemon log plus per-job log. `status` shows GPU, loaded tool,
  queue depth.
- Updates: pull plus restart. DB migrations forward-only.
- Backpressure: interactive queue preempts batch. Batch resumes
  automatically. No manual cleanup.

## Checks on boot
GPU present, driver version, free VRAM, cache dir writable,
sidecar binaries present. Fail with actionable message.

## Limits v1
One active GPU job at a time. Concurrent uploads allowed, concurrent
GPU infer is not. This is intentional for 8 GB stability.
