# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

High-throughput sharded order ingestion engine (backend engineering assessment). Ingests large
CSV order files (~10k+ records) via streams, backs the raw file up to GCS, validates rows on the
fly, and fans valid rows out across N sharded PostgreSQL instances using `CRC32(customer_id) % N`.
Exposes lookup by customer (single-shard) and by order ID (scatter-gather). A React frontend
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

Postgres shards (local dev, without running the app in Docker too):

```bash
docker compose up -d postgres_shard_1 postgres_shard_2 postgres_shard_3   # from src/backend
```

GCS auth is via Application Default Credentials, not a service-account key:

```bash
gcloud auth application-default login
```

`GCS_BUCKET_NAME` is required (`src/gcloud/bucket.ts` throws at startup if unset); `GCP_PROJECT_ID`
is optional. In Docker, `~/.config/gcloud` is mounted read-only into the app container so it picks
up the same ADC credentials.

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

### Ingestion pipeline (`POST /upload-orders`)

`controllers/uploadOrders.controller.ts` is the core of the system. Busboy parses the multipart
upload; the file stream is teed into two `PassThrough` branches:

- **Branch A** → piped straight to a GCS write stream (raw file backup), enforced by a 50MB
  Busboy `fileSize` limit and a first-chunk null-byte sniff to reject non-CSV binary uploads early.
- **Branch B** → piped through `fast-csv`'s streaming parser, each row validated against
  `orderRowSchema` (`src/validation/orderRow.ts`, zod). Invalid rows are skipped and recorded in
  `rowErrors` (not written to the DLQ — the response payload *is* the DLQ), not thrown.

Valid rows go into `ShardBufferManager` (`src/services/shardBuffer.service.ts`), which buffers
per-shard batches of `BATCH_SIZE` (500) and bulk-inserts via a single parameterized
`INSERT ... ON CONFLICT (order_id) DO NOTHING` per flush. Each shard tracks at most one in-flight
flush (`flushAsync`); a second batch filling up behind an in-flight flush triggers real
backpressure — the CSV stream is `pause()`d and only `resume()`d once that shard's flush settles
(`needsBackpressure` / `waitFor`), so per-shard buffers can't grow unbounded while a shard is slow.

The handler waits for **both** branches (GCS write `finish` + CSV `end` and final `flushAll()`)
before responding — `POST /upload-orders` is blocking, not fire-and-forget. Response:
`{ file, totalRows, successfulRows, failedRows, rowErrors }`.

### Error handling / lifecycle

- `middleware/asyncHandler.ts` wraps async route handlers so rejected promises reach the central
  error handler instead of hanging.
- `errors/AppError.ts` + `middleware/errorHandler.ts`: typed HTTP errors → JSON error responses.
- `shutdown.ts`: graceful shutdown on `uncaughtException` / `unhandledRejection`, closes the HTTP
  server and shard pools.
- `migrate.ts`: applies every `migrations/*.sql` file to every shard in parallel, tracked
  per-shard in a `schema_migrations` table so re-running is idempotent.

### Frontend

Vite + React 19 + MUI, talking to the backend via `src/frontend/src/api/client.ts`. Key pieces:
`UploadWorkspace`/`Dropzone` for the CSV upload flow, `MetricsSummary`/`ErrorLogTable` for
rendering the ingestion response (`totalRows`/`successfulRows`/`failedRows`/`rowErrors`),
`QueryWorkspace` for the customer/order-id lookup endpoints. `src/frontend/src/lib/crc32.ts`
mirrors the backend's shard-hash client-side (e.g. for showing which shard a customer routes to).
