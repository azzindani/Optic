# Optic — local vision workstation

Document and vision extraction on a single 8 GB GPU. Point it at a PDF or a
screen, get text now (live preview with box overlay) or structured fields
later (batch extraction). One or two models are resident on the GPU at a time.

Sibling project: [Syrinx](https://github.com/azzindani/Syrinx) (local audio workstation).

## What it does

- **Live extraction:** raw text fast, streamed over SSE with a reading-order
  box overlay in the web UI.
- **Targeted extraction:** layout + OCR + schema mapping to JSON
  (invoices, packing lists, bills of lading).
- **Two modes:** concurrency (many PDFs, pages per minute) and FPS
  (single stream, human-assisted). Interactive work preempts batch.
- **Headless and UI:** REST API for batch jobs, web viewer on the same jobs.

## Layout

| Path | What |
| --- | --- |
| `core/` | Node 24 + TypeScript + Fastify daemon (REST + SSE), job queue, GPU lease, SQLite store |
| `core/web/` | React + Vite viewer with canvas overlay |
| `tools/*/` | One Python sidecar per model over localhost HTTP; each has a `manifest.yaml` |
| `dev_tools/` | Playwright scripts used for screenshots and recordings |
| `docs/` | Concept, architecture, stack, tool registry, benchmarks |

Current tool sidecars: `turbo-tiny`, `granite-docling`, `unlimited-ocr`
(experimental), `yolo-live`, `segment-tiny`. See [docs/tools.md](docs/tools.md)
for VRAM budgets and which tools can be resident together.

## Quick start

Requires Node >= 24 and pnpm. GPU tools additionally need an NVIDIA GPU
(developed on an 8 GB card, WSL2 Ubuntu 24.04).

```bash
pnpm install
cd core
pnpm dev          # API on :3000
pnpm test         # vitest
pnpm typecheck
```

Tool sidecars are started separately; see each `tools/<id>/` directory and
[docs/tools.md](docs/tools.md). Model weights and caches are not in this
repository and are downloaded on first use (see `tools/unlimited-ocr/.env.example`
for the optional Hugging Face token).

## Docs

- [concept](docs/concept.md), [architecture](docs/architecture.md), [stack](docs/stack.md)
- [foundations](docs/foundations.md) (API versioning, job model, interfaces)
- [modes](docs/modes.md), [tools](docs/tools.md), [production](docs/production.md)
- [benchmarks](docs/benchmarks.md)

## Status

Single-user, localhost-only, under active development. Interfaces
(`Queue`, `Store`, `Gpu`, `Auth`, `Tools`) are written so enterprise
implementations can replace the single-user ones later.

## License

[MIT](LICENSE)
