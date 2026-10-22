# Full-Corpus Test Report (samples/, 158 PDFs)

Date: 2026-09-13. Engine: TurboOCR v3 tiny/TensorRT on RTX 3070 Ti 8 GB.

## Sweep (`dev_tools/sweep.sh` → `tmp/sweep.tsv`)

- 158/158 files OK, 0 failures
- 9,594 pages, 879,025 words in 11.6 min → **827 pg/min sustained**
- Word-weighted avg confidence **0.9761**; worst file-min 0.500 (fragments)
- Giants handled: 916-page CFR volume (110k words, 84 s), 737-page CFR (54 s)

## Screenshots (`dev_tools/shots.sh` → `tmp/shots/`, 158 PNGs)

First-page render + red predicted boxes per file (42 MB total).
Eye-checked: GST invoice (IRN/GSTIN/amounts exact, QR excluded),
bilingual IDX cover, dense 2009 SEC scan, UU legal text — tight boxes,
complete coverage. Only debris: split micro-headers at low confidence
(correctly scored ~0.5–0.6).

## Live video (`dev_tools/live-demo.html` + `record.mjs` → `tmp/live-30s.webm`)

30 s, 1280x800: BCA balance-sheet table fed at 2 fps through the real
gateway (job → frames → TurboOCR → SSE). Green boxes draw per frame,
markdown streams live (`JUMLAH ASET`, `TOTAL ASSETS`, all figures).

## Bugs found and fixed during the program

1. SSE `text/event-stream` bypassed the CORS plugin → EventSource
   blocked cross-origin. Fixed with manual ACAO header (`core/src/sse.ts`).
2. Live jobs processed one frame then stalled (worker only drains
   `queued`). Frames route re-arms live jobs (`core/src/index.ts`).
3. Base64 page renders bloated events (766 KB cover) → stripped to
   `[page-image]` placeholders (1.48 MB → 650 KB on IDX doc).

## Saved outputs (`dev_tools/save-outputs.sh`)

- `tmp/markdown/`: 158 `.md` files (32 MB), one per sample, via gateway
  PDF ingestion (page markers kept, embedded images stripped).
- `tmp/entities/`: 158 `.json` files (2.2 MB) — pattern-NER entities with
  page numbers (`?entities=1` second pass on the gateway).
- 157/158 in the batch run; the 676-page US Code needed a solo retry
  (3m48s, TurboOCR per-request limits) and is included.

## Live video (`tmp/live-30s.webm`, `tmp/live-shot.png`)

Re-recorded with the multi-color overlay: legend (text, layout:table,
layout:footer, layout:text, layout:doc_title, layout:number), blue table
regions + green text boxes over the BCA balance sheet, markdown streaming
live at 2 fps through the real gateway → TurboOCR → SSE path.

## Suite

Core tests 21/21 green (incl. entities, tables parser, result overrides,
pending-upload and frameless-live guards).

## Raft loop (`tmp/ui-raft.png`, `tmp/ui-edit.png`, `tmp/ui-color.png`)

- Multi-page PDF viewer (pdf.js, 100 dpi 1:1 overlay) with live entity
  labels on the document, schema field table, tables as grids with CSV
  download, Doc prev/next, JSON payload download.
- Fields editable: `POST /v1/jobs/:id/fields` stores human overrides as
  events; result JSON marks `source: human|model`, latest wins.
  Verified: invoice_no override persisted and served back as human.
- `GET /v1/jobs/:id/result?schema=` is the ERP payload: fields with
  conf/page/source, `missing_required`, tables with rows.
