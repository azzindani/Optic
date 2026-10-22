# Modes and Hardware

## Concurrency mode
Goal: pages per minute over many files.
Tuning: large batches, high pipeline pool, layout off unless needed,
PDF pages in parallel across CPU workers.

## FPS mode (human-assisted)
Goal: 5–10 fps on one stream with overlay.
Tuning: 960 px max side, layout off, single page, ROI re-infer on
correction. Targeted VLM runs on crop only (~0.3 s), never full page.

## Scheduler rule
Interactive preempts batch. Batch throughput drops to ~20% during
assist, then recovers. No inference during model switch.

## Headless
- `POST /jobs` with tool, mode, files.
- `GET /jobs/{id}` for status and artifacts.
- CLI wraps same endpoints for scripts.

## Live UI
- `WS /jobs/{id}/live` streams page status, boxes, markdown patches,
  field JSON patches.
- Viewer shows overlay, copy button, history, approve/correct.
- Phone or desktop browser can supply frames via screen share.
  No native capture dependency.

## Current hardware (Sep 2026 check)
- WSL2 Ubuntu 24.04, 20 threads i7-12700H, 23 GB RAM, 1 TB disk.
- GPU: RTX 3070 Ti Laptop 8 GB via `/dev/dxg`, driver 596.36.
- No `/dev/video`, no `/dev/dri`, no native `/dev/nvidia*`.
  Browser frame supply required for live.
- VRAM budget: cap resident at 7 GB, keep 1 GB headroom.
