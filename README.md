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

**Bounded streaming backpressure.** The upload handler
(`src/backend/src/controllers/uploadOrders.controller.ts`) tees the incoming multipart file stream
into two branches — one piped straight to a GCS write stream, one through `fast-csv`'s streaming
parser — so the process never buffers the whole file in memory. Valid rows are queued into
per-shard batches (`ShardBufferManager`, `src/backend/src/services/shardBuffer.service.ts`) capped
at `BATCH_SIZE` (500). A batch is flushed asynchronously as soon as it fills, but if a *second*
full batch piles up behind a shard whose flush is still in flight, the CSV stream itself is
`pause()`d and only `resume()`d once that shard's flush settles. This keeps per-shard memory
bounded — a batch and a half in flight, at most — without stalling on every single flush.

**Cross-shard parallel flushing.** Each shard's buffer flushes independently: `ShardBufferManager`
tracks at most one in-flight flush *per shard*, so a slow shard 2 never blocks shards 1 or 3 from
flushing their own full batches. On end-of-stream, `flushAll()` waits for every shard's in-flight
flush and then flushes any remaining partial batches, all via `Promise.all` — final flush latency
is bounded by the slowest shard, not the sum of all shards.

**Intentional intra-shard serialization.** Within a single shard, flushes are *not* parallelized —
a second batch that fills up while a flush is already running just waits for the in-flight promise
(`waitFor`) rather than firing a concurrent query. This is deliberate: parallel writes to the same
shard would let their batches complete out of order for no throughput benefit (one Postgres
connection pool, one bottleneck), while adding retry/ordering complexity for row batches from a
single CSV that don't need it. Backpressure on a shard converts "queue more work behind a slow
shard" into "briefly pause the source," which is simpler and keeps memory bounded.

**Scatter-gather for non-shard-key lookups.** `GET /orders/:orderId`
(`src/backend/src/controllers/getOrderById.controller.ts`) can't know which shard holds a given
order without checking, since `order_id` isn't the hash key. It queries every shard pool in
parallel (`Promise.all`) and returns the one match (`order_id` is each shard's primary key) or 404
if none has it. Cheap at N=3; would need a shard-lookup index or a different partitioning strategy
to stay cheap at much larger N.

**Blocking ingestion response.** `POST /upload-orders` waits for the GCS write and all DB flushes
to complete before responding, returning
`{ file, totalRows, successfulRows, failedRows, rowErrors }`. This was a deliberate choice to give
the caller real ingestion metrics — including per-row validation failures — in one round-trip,
rather than a fire-and-forget `202` with no visibility into row-level outcomes.

## Project layout

```
src/backend/    Express API, streaming ingestion, sharded Postgres pools, migrations
src/frontend/   Vite + React UI for upload and query
```

See `src/backend/README.md` and `CLAUDE.md` for further implementation detail.
