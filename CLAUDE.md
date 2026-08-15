# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

High-throughput sharded order ingestion engine (backend engineering assessment). Ingests large
CSV order files (~10k+ records) via streams, backs the raw file up to GCS, validates rows on the
fly, and fans valid rows out across N sharded PostgreSQL instances using `CRC32(customer_id) % N`.
Ingestion runs as a background job (pg-boss) so the upload request returns immediately. Exposes
lookup by customer (single-shard) and by order ID (scatter-gather). A React frontend
(`src/frontend`) provides an upload/query UI.

Two independent npm projects: `src/backend` (Node/Express API) and `src/frontend` (Vite/React
UI). There is no root `package.json` — run commands from within each project directory.

## Commands

All from `src/backend`:

```bash
npm run dev              # dev server, tsx watch
npm run build             # tsc -> dist/
npm start                 # run compiled dist/server.js
npm run migrate           # apply migrations/*.sql to every shard (parallel, tracked in schema_migrations)
npm run query              # tsx src/queryShards.ts — ad hoc shard query script
npm run format             # prettier --write src
```

No test suite or lint script exists in the backend yet.

All from `src/frontend`:

```bash
npm run dev        # vite dev server
npm run build       # tsc -b && vite build
npm run lint         # oxlint
npm run preview      # preview built dist/
```

Postgres shards + the pg-boss job queue DB (local dev, without running the app in Docker too):

```bash
docker compose up -d postgres_shard_1 postgres_shard_2 postgres_shard_3 postgres_jobs   # from src/backend
```

GCS auth is via Application Default Credentials, not a service-account key:

```bash
gcloud auth application-default login
```

`GCS_BUCKET_NAME` is required (`src/gcloud/bucket.ts` throws at startup if unset); `GCP_PROJECT_ID`
is optional. `PGBOSS_URL` is required (`src/db/pgBoss.ts` throws at startup if unset) and must
point at a Postgres database distinct from the shards — pg-boss self-manages its own schema there.
In Docker, `~/.config/gcloud` is mounted read-only into the app container so it picks up the same
ADC credentials.

**Gotcha:** `docker-compose.yml` hardcodes `SHARD_1_URL`/`SHARD_2_URL`/`SHARD_3_URL` in the `app`
service's `environment:` block *and* loads `.env` via `env_file:`. Under Docker the inline
`environment:` values win over `.env` — if you're pointing at different shard hosts, edit
`docker-compose.yml` directly rather than just `.env`.

## Architecture

### Sharding

Shard assignment is application-level, computed in Node before every write or customer-scoped
read: `crc32(customer_id) % shardCount` (`src/db/shardRouter.ts`, using Node's built-in
`zlib.crc32`). `src/db/pool.ts` discovers every `SHARD_<n>_URL` env var, numeric-sorts them, and
builds one `pg.Pool` per shard — shard count is derived from however many `SHARD_*_URL` vars are
set, not hardcoded.

Because `customer_id` (not `order_id`) is the shard key: `GET /orders?customerId=` routes directly
to one shard pool (`getShardPoolForCustomer`) and hits `idx_orders_customer_date (customer_id,
order_date DESC)`. `GET /orders/:orderId` can't know which shard holds an order, so it
scatter-gathers — queries every shard pool in parallel via `Promise.all` and takes the one match
(cheap at N=3, would need a shard-lookup index at much larger N).

### Ingestion pipeline (`POST /upload-orders/init` + `/complete` + async job)

Cloud Run hard-caps request bodies at 32MiB, so the file is never streamed through this service
(the old Busboy/temp-file version is in git history only). Instead it's a three-step, direct-to-GCS
flow:

1. `POST /upload-orders/init` (`initUpload`, `uploadOrders.controller.ts`) validates the file info
   (`initUploadSchema`, zod) and mints a short-lived (15 min) v4 signed GCS URL for
   `staging/<uuid>-<filename>`, returning `{ uploadUrl, stagingPath }`.
2. The browser `PUT`s the file bytes **directly to `storage.googleapis.com`**, bypassing the
   backend entirely (`src/frontend/src/api/client.ts`).
3. `POST /upload-orders/complete` (`completeUpload`) enqueues a pg-boss job (`upload-orders` queue,
   `src/jobs/uploadOrders.job.ts`) with `{ stagingPath, filename, mimeType }` — just a GCS pointer,
   no file data — and responds `202 { jobId }`.

The actual ingestion work runs in the pg-boss worker (`registerUploadOrdersWorker()`, registered
in-process alongside `app.listen` in `server.ts`). It re-checks the staged object's real size
against `MAX_FILE_BYTES` (500MB) via `stagingFile.getMetadata()` — the client-declared size from
`init` is untrusted — then calls `ingestOrdersFile()` (`src/services/ordersIngest.service.ts`)
with the staged GCS `File` object. Since the upload already lives in GCS (the client PUT it there
directly), the permanent backup is a **server-side GCS copy** (`sourceFile.copy(destFile)` to
`orders/<uuid>-<filename>`) — no bytes round-trip through the worker — run via `Promise.all`
alongside a single read stream that's piped through `fast-csv`'s parser, with a first-chunk
null-byte sniff on that same stream to reject non-CSV binary uploads. Each row is validated against
`orderRowSchema` (`src/validation/orderRow.ts`, zod); invalid rows are skipped and recorded in
`rowErrors` (not written to the DLQ — the response payload *is* the DLQ), not thrown. If either the
copy or the parse/ingest side fails, the permanent backup object is best-effort deleted so it
doesn't linger orphaned.

Valid rows go into `ShardBufferManager` (`src/services/shardBuffer.service.ts`), which buffers
per-shard batches of `BATCH_SIZE` (500) and bulk-inserts via a single parameterized
`INSERT ... ON CONFLICT (order_id) DO NOTHING` per flush. Each shard tracks at most one in-flight
flush (`flushAsync`); a second batch filling up behind an in-flight flush triggers real
backpressure — the CSV stream is `pause()`d and only `resume()`d once that shard's flush settles
(`needsBackpressure` / `waitFor`), so per-shard buffers can't grow unbounded while a shard is slow.

`ingestOrdersFile()` resolves with `{ file, totalRows, successfulRows, failedRows, rowErrors }`,
which pg-boss stores as the job's `output`. The `staging/` object is deleted in a `finally` once
the job settles either way — a crash between `complete` and that `finally` orphans the staging
object (no bucket lifecycle rule visible for the `staging/` prefix). The `upload-orders` queue is
created with `retryLimit: 0` (via `createQueue` + `updateQueue`, so it applies even if the queue
already existed with different settings) — ingestion failures like a malformed CSV are
deterministic on the same staged file, so a retry would just fail again the same way; note this
also means a worker crash mid-job (not a thrown error) isn't retried either, since pg-boss has no
visible job-expiry config here to notice the worker died.

`GET /upload-orders/:jobId` (`getUploadJob.controller.ts`) polls job state via
`boss.getJobById()`: `processing` while active/queued, `done` with the ingestion result once
`completed`, or `error` with the failure message (pg-boss serializes thrown errors into `output`
via `serialize-error`) once `failed`/`cancelled`.

### Error handling / lifecycle

- `middleware/asyncHandler.ts` wraps async route handlers so rejected promises reach the central
  error handler instead of hanging.
- `errors/AppError.ts` + `middleware/errorHandler.ts`: typed HTTP errors → JSON error responses.
- `shutdown.ts`: graceful shutdown on `uncaughtException` / `unhandledRejection` — stops the HTTP
  server, stops pg-boss (`boss.stop({ graceful: true })`), then closes shard pools. No SIGTERM/
  SIGINT handling currently.
- `migrate.ts`: applies every `migrations/*.sql` file to every shard in parallel, tracked
  per-shard in a `schema_migrations` table so re-running is idempotent. This does not touch
  pg-boss's schema — that's self-managed by `boss.start()` in a separate database (`PGBOSS_URL`).
- `GET /metrics` returns in-process counters (`src/metrics.ts`): uploads started/succeeded/failed,
  rows ingested/failed, uptime.

### Frontend

Vite + React 19 + MUI, talking to the backend via `src/frontend/src/api/client.ts`. Key pieces:
`UploadWorkspace`/`Dropzone` for the CSV upload flow — `UploadWorkspace` calls `init`, `PUT`s the
file straight to the signed GCS URL, calls `complete`, then polls `GET /upload-orders/:jobId` on a
flat 2s interval until the job is `done`/`error` — `MetricsSummary`/
`ErrorLogTable` for rendering the final ingestion result (`totalRows`/`successfulRows`/
`failedRows`/`rowErrors`), `QueryWorkspace` for the customer/order-id lookup endpoints.
`src/frontend/src/lib/crc32.ts` mirrors the backend's shard-hash client-side (e.g. for showing
which shard a customer routes to).

### Deployment

`.github/workflows/deploy.yml` runs on every push to `master`: builds the backend Docker image
(`src/backend/Dockerfile`) and deploys it to Cloud Run (`asia-south1`, Cloud SQL via the
`--add-cloudsql-instances` Unix socket connector, shard/PGBoss URLs injected from Secret Manager),
then builds the frontend with `VITE_API_BASE_URL` pointed at the freshly-deployed Cloud Run URL
and deploys it to Firebase Hosting. Auth is via Workload Identity Federation, no long-lived GCP
keys in CI.

See `ARCHITECTURE.md` for the full design writeup (sequence/component diagrams, schema, API
reference, and a decisions table with alternatives considered) — this file covers the same ground
but at implementation-file granularity.
