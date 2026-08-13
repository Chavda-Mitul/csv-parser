# High-Throughput Sharded Order Ingestion Engine

Ingests large CSV order files (~10k+ records) via streams, backs the raw file up to Google Cloud
Storage, validates rows on the fly, and fans valid rows out across N sharded PostgreSQL instances
using `CRC32(customer_id) % N`. Exposes lookup by customer (single-shard) and by order ID
(scatter-gather across all shards). A React frontend provides an upload/query UI on top of the API.

Two independent projects, each with its own `package.json`:

- `src/backend` — Node.js (Express 5) API, streaming ingestion pipeline, sharded Postgres access.
- `src/frontend` — Vite + React 19 + MUI UI for uploading CSVs and querying orders.

## Production deployment

- **Frontend:** https://project-e0877da6-3d8f-478e-9d0.web.app (Firebase Hosting)
- **Backend API:** https://csv-backend-872514907180.asia-south1.run.app (Cloud Run)

Backend runs on Cloud Run, connected to Cloud SQL (PostgreSQL) over the private Unix-socket
connector. Frontend is a static build on Firebase Hosting. Both deploy automatically via GitHub
Actions on push to `master` — see `.github/workflows/deploy.yml`.

## Setup

### 1. Backend environment

```bash
cd src/backend
npm install
cp .env.example .env   # fill in real values (GCS bucket, shard URLs)
```

### 2. GCP Application Default Credentials

The backend authenticates to GCS via ADC rather than a service-account key, both locally and in
Docker:

```bash
gcloud auth application-default login
```

This writes credentials to `~/.config/gcloud/application_default_credentials.json`
(`%APPDATA%\gcloud` on Windows). `GCS_BUCKET_NAME` is required — `src/gcloud/bucket.ts` throws at
startup if it's unset. `GCP_PROJECT_ID` is optional, only needed if ADC can't infer the project.

### 3. Start the Postgres shards

```bash
docker compose up -d postgres_shard_1 postgres_shard_2 postgres_shard_3
```

This brings up three independent Postgres 15 containers (`shard_1`/`shard_2`/`shard_3`, ports
`5432`/`5433`/`5434`). To run the app in Docker too (mounting your ADC credentials read-only into
the container):

```bash
docker compose up
```

> **Note:** `docker-compose.yml` hardcodes `SHARD_1_URL`/`SHARD_2_URL`/`SHARD_3_URL` in the `app`
> service's `environment:` block *and* loads `.env`/`.env.docker` via `env_file:`. Under Docker the
> inline `environment:` values win over `.env` — if you're pointing at different shard hosts, edit
> `docker-compose.yml` directly rather than just `.env`.

### 4. Apply migrations

```bash
npm run migrate
```

Applies every file in `migrations/` to all shards in parallel, tracked per-shard in a
`schema_migrations` table — safe to re-run.

### 5. Run the backend

```bash
npm run dev              # local dev server (tsx watch)
# or
npm run build && npm start   # compiled, production-style
```

Smoke test:

```bash
curl localhost:3000/health
```

### 6. Run the frontend

```bash
cd src/frontend
npm install
npm run dev
```

## Sharding strategy: `CRC32(customer_id) % N`

Shard assignment is application-level and consistent: every write and every customer-scoped read
computes `crc32(customer_id) % shardCount` in Node (`src/backend/src/db/shardRouter.ts`, using the
built-in `zlib.crc32`) before picking a `pg.Pool`. `shardCount` isn't hardcoded — `db/pool.ts`
discovers every `SHARD_<n>_URL` environment variable, numeric-sorts them, and opens one pool per
shard, so the shard count is however many `SHARD_*_URL` vars are configured.

Because the hash is a pure function of `customer_id`, the same customer always lands on the same
shard on every request — no coordination or lookup table needed between rows, and no cross-shard
transaction is ever required for a single customer's writes. This was chosen over a single
database or DB-native (range/list) partitioning for two reasons:

- **Locality for customer history.** All of a customer's orders land on one shard, so
  `GET /orders?customerId=` is a single targeted query against
  `idx_orders_customer_date (customer_id, order_date DESC)` — no cross-shard merge or sort.
- **Horizontal write scaling.** A 10k+ row CSV ingest fans out across N independent Postgres hosts
  instead of serializing through one, since shard assignment needs no coordination between rows.

The trade-off: `order_id` is *not* the shard key, so a lookup by order ID can't be routed directly
to one shard — see scatter-gather below.

## System design trade-offs

- **Bounded streaming backpressure.** The upload stream is teed into a GCS write branch and a
  `fast-csv` parse branch, so the process never buffers the whole file in memory. Valid rows batch
  per-shard (`ShardBufferManager`, cap `BATCH_SIZE=500`); if a second full batch piles up behind a
  shard whose flush is still in flight, the CSV stream is paused until that flush settles.
- **Cross-shard parallel flushing.** Each shard flushes independently (one in-flight flush per
  shard), so a slow shard never blocks the others. Final flush latency is bounded by the slowest
  shard, not the sum of all shards.
- **Intentional intra-shard serialization.** A shard never runs two flushes concurrently — a second
  batch just waits for the in-flight one. One connection pool per shard is the real bottleneck
  anyway, so parallelizing within a shard would only add ordering complexity for no throughput gain.
- **Scatter-gather for non-shard-key lookups.** `GET /orders/:orderId` can't know which shard holds
  an order (`order_id` isn't the hash key), so it queries every shard in parallel and returns the
  one match. Cheap at N=3; would need a shard-lookup index at much larger N.
- **Async ingestion via job queue.** `POST /upload-orders` only stages the file (validates, streams
  to disk, backs up to GCS) and returns `202 { jobId }` immediately — it doesn't wait for CSV
  parsing or DB writes. The actual ingestion runs in a background pg-boss job; poll
  `GET /upload-orders/:jobId` for `{ status, result }` (`totalRows`/`successfulRows`/`failedRows`/
  `rowErrors`) once it completes.

See `CLAUDE.md` for the full pipeline breakdown (file paths, module names, error handling).

## Project layout

```
src/backend/    Express API, streaming ingestion, sharded Postgres pools, migrations
src/frontend/   Vite + React UI for upload and query
```

See `src/backend/README.md` and `CLAUDE.md` for further implementation detail.
