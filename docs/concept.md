# Optic — Concept

## What it is
General vision workstation in one project. Catalog can grow to all
vision tech (OCR, detection, segmentation, classification, tracking,
depth, pose, VLM ask). Only one or two tools resident on GPU at a time.

## Why
- One tool for productivity: point at document or screen, get text now,
  extract fields when needed.
- Same backend serves automation and humans.
- Fits single 8GB GPU via explicit select-to-load.

## Two flagship uses (v1)
1. **Targeted extraction (Raft-like):** layout + OCR + schema mapping
   to JSON. Example: invoice, packing list, bill of lading to fields.
   Optimized for accuracy.
2. **Live document extraction:** raw text fast. Optimized for speed.

## Two performance modes (both required)
- **Concurrency:** many PDFs and pages in parallel, pages per minute.
- **FPS:** single stream at 5–10 fps for human-assisted extraction
  with live overlay and correction.

Not simultaneous at full blast on 8GB. Scheduler prioritizes
interactive over batch.

## Dual interface
- **Headless:** REST API and CLI for batch jobs.
- **UI:** web viewer subscribing to same jobs over WebSocket,
  showing pages, boxes, markdown, and field JSON live.

## Rule
Project root is `Optic`. Core dir is `core`. No sub dir, package,
module, or function uses `optic` as prefix or name.
