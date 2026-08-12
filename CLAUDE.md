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

### Ingestion pipeline (`POST /upload-orders` + async job)

`POST /upload-orders` only *stages* the upload: Busboy parses the multipart request, validates the
file info (`fileInfoSchema`, zod) and 50MB size limit, and streams the raw bytes to a temp file on
disk. As soon as that write finishes it enqueues a pg-boss job (`upload-orders` queue,
`src/jobs/uploadOrders.job.ts`) with the temp file path, and responds `202 { jobId }` — it does not
wait for GCS backup, CSV parsing, or any DB writes.

The actual ingestion work runs in `ingestOrdersFile()` (`src/services/ordersIngest.service.ts`),
called from the pg-boss worker (registered in-process via `registerUploadOrdersWorker()`, alongside
`app.listen` in `server.ts`) against `fs.createReadStream(tempFilePath)`. It tees that stream into
two `PassThrough` branches:

- **Branch A** → piped to a GCS write stream (raw file backup), with a first-chunk null-byte sniff
  to reject non-CSV binary uploads.
- **Branch B** → piped through `fast-csv`'s streaming parser, each row validated against
  `orderRowSchema` (`src/validation/orderRow.ts`, zod). Invalid rows are skipped and recorded in
  `rowErrors` (not written to the DLQ — the response payload *is* the DLQ), not thrown.

Valid rows go into `ShardBufferManager` (`src/services/shardBuffer.service.ts`), which buffers
per-shard batches of `BATCH_SIZE` (500) and bulk-inserts via a single parameterized
`INSERT ... ON CONFLICT (order_id) DO NOTHING` per flush. Each shard tracks at most one in-flight
flush (`flushAsync`); a second batch filling up behind an in-flight flush triggers real
backpressure — the CSV stream is `pause()`d and only `resume()`d once that shard's flush settles
(`needsBackpressure` / `waitFor`), so per-shard buffers can't grow unbounded while a shard is slow.

`ingestOrdersFile()` resolves with `{ file, totalRows, successfulRows, failedRows, rowErrors }`,
which pg-boss stores as the job's `output`. The temp file is unlinked in a `finally` once the job
settles either way. The `upload-orders` queue is created with `retryLimit: 0` (via `createQueue` +
`updateQueue`, so it applies even if the queue already existed with different settings) —
ingestion failures like a malformed CSV are deterministic on the same staged file and the temp file
is already gone after the first attempt, so a retry would just fail again with a misleading
"file not found" instead of the real error.

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
`UploadWorkspace`/`Dropzone` for the CSV upload flow — `UploadWorkspace` posts the file, then polls
`GET /upload-orders/:jobId` on a flat 2s interval until the job is `done`/`error` — `MetricsSummary`/
`ErrorLogTable` for rendering the final ingestion result (`totalRows`/`successfulRows`/
`failedRows`/`rowErrors`), `QueryWorkspace` for the customer/order-id lookup endpoints.
`src/frontend/src/lib/crc32.ts` mirrors the backend's shard-hash client-side (e.g. for showing
which shard a customer routes to).
