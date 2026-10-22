# Sample Eval (real corpus, `samples/`, 158 files)

Stratified run through `POST /v1/jobs/:id/pdf` (TurboOCR tiny, 3070 Ti).
Times are wall-clock gateway end-to-end.

| File | Pages | Time | Notes |
|---|---|---|---|
| invoice_IN-601.pdf (GST scan) | 2 | 0.2 s | IRN, Ack No, GSTINs, addresses exact |
| resume_Image_52.pdf | 1 | 0.1 s | Clean markdown, headings kept |
| UU Nomor 16 Tahun 2009.pdf (ID legal) | 11 | 0.6 s | Near-perfect ID; `20O8` O/0 slip |
| contract affiliate (SEC scan) | 6 | 0.6 s | Legal English exact, `agreesto` join slip |
| us_gov bill | 6 | 0.2 s | Clean |
| IDX BBCA Q1 2026 financials | 183 | 11.8 s | ~15 pg/s; tables + ID text strong |

## Targeted fields (invoice_IN-601, structured words + rules)

invoice_no `UGS/2022-23/5087`, irn full 64-hex, ack_no, gstin all hit.
`dated` grabbed a line-item date over the header date — rules need
nearest-to-label logic next.

## Findings fixed

- TurboOCR embeds page renders as base64 in markdown (cover was
  766 KB). Gateway now strips to `[page-image]` placeholders:
  1.48 MB → 650 KB events for the IDX doc. Raw pages stay in the
  stored input PDF.

## Known slips

Single-char OCR confusions (`ASLA`, `oo2`, `o21`, missing spaces in
legal joins). Candidates: `small` tier or `CLS_ALL_BOXES=1` for scans.
Granite-Docling covers handwriting/exotic layouts via image frames.

## Vision-measured accuracy (eye-checked overlays)

Method: pages rendered at 100 dpi via pymupdf, predicted quads drawn in
red, judged visually; confidences from structured `/ocr/pdf`.

| Page | Boxes | Avg conf | Min | Verdict |
|---|---|---|---|---|
| invoice_IN-601 p1 (GST scan) | 72 | 0.978 | 0.591 | Tight, full coverage; QR correctly excluded; only debris is a split `Sl/No.` header (`ochtes` 0.59) |
| invoice_IN-601 p2 | 92 | 0.985 | 0.820 | Clean incl. CGST/SGST amounts |
| UU 16/2009 p1 (ID legal) | 43 | 0.985 | 0.948 | Line-tight boxes, nothing missed |
| UU 16/2009 p2 | 37 | 0.980 | 0.889 | Same; one `Agar ...` 0.89 |

Only 4 of 244 boxes below 0.9, all correctly low (fragments). Reading
order sane on tables, addresses, multi-line IDs. Overlays:
`/tmp/vis-inv-p1-boxes.png`, `/tmp/vis-uu-p1-boxes.png`.
