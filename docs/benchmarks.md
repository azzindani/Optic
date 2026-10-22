# Benchmarks (RTX 3070 Ti Laptop 8 GB, WSL2, Sep 2026)

Method: wall-clock curl against local sidecars. Test image 800x300 PNG,
invoice.pdf 1 page, tables.pdf 3 pages (75 dense rows).

## Live inference (TurboOCR :8000, tiny tier)

- Warmup: 71 ms first call
- Steady: 13–20 ms per frame → ~50–70 fps
- Headroom above the 5–10 fps interactive target; gateway worker poll
  (500 ms) dominates end-to-end frame latency, not inference.

## Batch (TurboOCR /ocr/pdf?markdown=1)

- 3 pages dense tables: 0.38 s → ~7.9 pg/s (~470 pg/min)
- 1 page invoice: 45 ms
- Numeric fidelity verified on 75 financial rows.

## Targeted (Granite-Docling :8002, 256M, bf16, CUDA)

- 64 tokens: 3.5 s; 256 tokens: 6.9 s (thermally throttled laptop)
- Output: DocTags with loc boxes; fields extracted: invoice_no, date,
  total, hs_code — all correct on the invoice sample.
- Verdict: right for on-demand field extraction on a crop, not for
  live. Keep live on TurboOCR, route crops to Granite.

## Notes

- TurboOCR container holds ~4.4 GB VRAM; Granite sidecar ~1 GB.
  Both fit the 8 GB budget together; manager cap stays 7 GB.
- Gateway SSE replay and SQLite resume covered by core tests (12/12).
