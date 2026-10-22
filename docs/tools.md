# Tools

## Plugin contract
Each tool is one dir under `tools/` with:
- `manifest.yaml`: id, backend, vram estimate, labels, tier.
- `load()`, `unload()`, `infer()` with common I/O.

Backends allowed: tensorrt, vllm, onnx, transformers, sglang.
Deps isolated per tool. No giant shared requirements file.

## v1 registry (OCR first)
- `turbo-tiny` — TensorRT, ~4 GB. Live and batch markdown. Fast lane.
- `turbo-small` — TensorRT, ~6 GB. Higher accuracy batch.
- `granite-docling-258M` — vLLM, ~0.5 GB. Targeted prompts,
  DocTags, boxes, tables. Pairs with turbo-tiny for assist.
- `paddle-vl-1.6` — vLLM, ~2 GB. Multilingual targeted, 100+ langs.
  Added second, not resident with full turbo pipeline.
- `unlimited-ocr-3B` — vLLM, ~5 GB measured at 8K ctx (AWQ lane,
  sahilchachra/Unlimited-OCR-AWQ + local position_ids/ignore fixes).
  One-shot multi-page docs with constant memory. Long contracts.
  Batch-only; coexists with granite, never with turbo. EXPERIMENTAL.
  Measured ceiling on 8 GB (WSL2, 6.93 GB addressable): 16K ctx serves,
  24K/32K do not (KV need 1.41/1.88 GB vs ~1 GB avail). Lane chunking:
  1 page excellent, ~6 pages good with repetition_penalty=1.15,
  10 pages show tail hallucination on exhibits. Recipe n-gram processor
  (vllm_xargs) not confirmed engaging — follow-up. BF16 does NOT fit 8 GB
  (fixed ~9.2 GB demand).
- Live extraction preview (human-assist): det grounding tokens parsed to
  `box` events in reading order (0-1000 space, `det:` kinds) + per-page
  `markdown` over the existing SSE; UI overlays boxes with a glowing
  reading cursor and auto-follows pages. Route: `POST /v1/jobs/:id/pages`
  (frontend pdfjs explode, CPU — demo split).

Only the selected combo is resident. Switching cost 2–5 s cached.

## Future tools (stubs, not built now)
- `layout-detect` — DocLayout-YOLO, RT-DETR, YOLO11.
- `segment-tiny` — transformers, ~1 GB provisional. SAM2-tiny box-prompted
  masks (~1 s) + auto-mask. Boxes for overlay via the generic live path
  (no core changes). Masks compose with det boxes (refine any box to
  pixels). EXPERIMENTAL.
- `table` — SLANet to HTML, FormulaNet to LaTeX.
- `yolo-live` — onnx, ~0.5 GB provisional. YOLO11n-seg COCO instance
  masks + persistent track IDs at live rate. Fast lane; SAM2 refines any
  box to pixels. EXPERIMENTAL.
- SAM2 video tracking (masklet propagation, ~20 fps) — QUEUED, not built:
  needs the native `sam2` package (pip sdist stalled on build deps here).
  Covered 80% today by YOLO ByteTrack IDs (30 fps) + SAM2 per-frame
  box-refine (1 s).
- `classify`, `depth`, `pose`, `vlm-ask` — still future stubs.

Adding one is: new dir plus registry entry. No core rewrite.

## Presets (tool combos)
- Live Assist: turbo-tiny plus granite-docling.
- Batch Markdown: turbo-small.
- Raft Fields: paddle-vl-1.6.
- Long Contract: unlimited-ocr.
