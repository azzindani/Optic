# Architecture

## Layout
```
Optic/
  core/      # gateway, scheduler, gpu manager, store, web shell
  tools/     # one dir per tool, self-contained plugin
  docs/      # concept, architecture, tools, modes
```

No `optic-*` sub dirs. Core is `core`.

## Core responsibilities
- **gateway:** creates jobs, routes to batch or interactive queue.
  Serves `POST /v1/jobs`, `GET /v1/jobs/:id`,
  `GET /v1/jobs/:id/events` (SSE), `POST /v1/jobs/:id/frames`,
  `POST /v1/jobs/:id/corrections`, `GET /v1/gpu`,
  `POST /v1/tools/:id/load`. Stateless, scalable behind any LB.
- **scheduler:** two queues. Interactive preempts batch. Batch resumes
  after. Jobs stay queued during model switch.
- **gpu manager:** select-to-load. Loads exactly the chosen tool combo,
  unloads the rest. Enforces VRAM cap (7 GB of 8 GB, 1 GB headroom).
  Reports `GET /gpu` status and streams load progress.
- **store:** images, pages, boxes, masks, markdown, JSON. Common schema
  for every vision task: `image -> boxes / masks / labels / text + overlay`.
- **web shell:** viewer plus tool dropdown. No per-tool UI fork.

## Flow
1. Client creates job with `tool` and `mode`.
2. Manager ensures tool loaded, else drain, unload, load, warmup.
3. Workers render pages, filter text layer, run GPU infer.
4. Results stream as SSE events: `page`, `box`, `markdown`, `fields`,
   `status`. Upstream frames and corrections arrive via plain POST,
   so no sticky sessions are needed.
5. Human corrections re-run inference on ROI crop only.

## Concurrency model
Many thin CPU workers share one GPU server. Parent budgets GPU
concurrency. Text-layer-first: skip GPU where native PDF text is good.
VLM only on low-confidence or targeted pages.
