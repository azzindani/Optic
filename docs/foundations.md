# Foundations (single now, enterprise later)

Rule: routes stay stateless. All state goes through interfaces with
a single-user impl today and an enterprise impl later.

## Versioning
All APIs under `/v1`. Breaking changes go to `/v2`. Clients send
`Idempotency-Key` on job create.

## Job model
```
id, owner_id, tool_id, mode, status,
input_refs, artifact_refs, error,
idempotency_key, created_at, updated_at
```
v1: `owner_id` always `local`. Enterprise: real tenant id. No schema
change needed later.

## Interfaces (in `core/`, no `optic-*` names)
- `Queue`: `enqueue`, `dequeue`, `pause`, `resume`, `stats`.
  Now: in-process. Later: Redis or NATS.
- `Store`: `savePage`, `saveArtifact`, `getJob`, `listJobs`.
  Now: SQLite plus fs. Later: Postgres plus S3.
- `Gpu`: `status`, `load(tool)`, `unload(tool)`, `withLease(fn)`.
  Now: exclusive lock on 1 GPU, 7 GB cap. Later: pool across N GPUs.
- `Auth`: `verify(request) -> owner_id`.
  Now: static local token. Later: JWT or SSO, same hook.
- `Tools`: `register(manifest)`, `get(id)`, `list()`.
  Manifest carries version, backend, vram, tiers.

## Auth from day one
Middleware present but permissive: checks local token file.
Enterprise adds issuer check without touching routes.

## Observability hooks
- `GET /v1/health`, `GET /v1/metrics` (counters only in v1).
- Per-job event log persisted in store. Live view tails it over SSE
  `GET /v1/jobs/:id/events` with `Last-Event-ID` replay.
- Later: Prometheus labels plus trace ids, no route change.

## What stays out of v1
Multi-tenancy quotas, rate limits, audit export, SSO, fleet
autoscaling, multi-GPU placement. All fit the interfaces above.
