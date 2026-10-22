# Stack

Locked for v1 single-user. No Python in production path.

## Core (`core/`)
- Runtime: Node 24, TypeScript strict.
- API: Fastify for REST plus SSE.
  Routes: `POST /v1/jobs`, `GET /v1/jobs/:id`,
  `GET /v1/jobs/:id/events` (SSE), `POST /v1/jobs/:id/frames`,
  `POST /v1/jobs/:id/corrections`, `GET /v1/gpu`,
  `POST /v1/tools/:id/load`.
- Package: pnpm workspaces, tsc, vitest, eslint.
- Daemon: localhost only. Commands: `start`, `stop`, `status`.
  PID file plus health endpoint. No fleet code in v1.

## Web (`core/web/`)
- React plus Vite plus TypeScript, canvas overlay viewer.
- Frame supply via `getDisplayMedia` plus `POST` frames. Patches over SSE:
  boxes, markdown chunks, field JSON.
- Served by core locally. No separate deploy in v1.

## Tools (`tools/*/`)
- Sidecar per tool over localhost HTTP. Core never imports ML code.
- `turbo-*`: native C++ CUDA TensorRT binary, HTTP already.
- `granite-docling`, `paddle-vl`, `unlimited-ocr`: Python micro-servers
  with isolated `uv` envs (vLLM, SGLang, transformers). Only code
  allowed to use Python.
- Manifest per tool: id, backend, vram estimate, tier, version.

## Store and queue v1
- SQLite for jobs plus filesystem for pages and artifacts.
- In-process queue behind `Queue` interface. Same interface takes
  Redis or NATS later.
- Model cache under user cache dir. TensorRT engines cached across
  restarts. Offline after first download.

## Deferred
Redis, Postgres, S3, Docker Compose fleet, K8s, SSO. See foundations.

## Escape hatches (no rewrite)
- GPU manager plus scheduler can move to Go later. HTTP contract stays.
- Web can wrap in Tauri or Electron later. Same endpoints.
