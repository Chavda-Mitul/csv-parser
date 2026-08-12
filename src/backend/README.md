# High-Throughput Sharded Order Ingestion Engine

Ingests large CSV order files (~10k+ records) via streams, backs the raw file up to GCS,
validates rows on the fly, and fans valid rows out across N sharded PostgreSQL instances using
`CRC32(customer_id) % N`. Exposes lookup by customer (single-shard) and by order ID
(scatter-gather across all shards).

## Setup & Run

```bash
npm install
cp .env.example .env   # fill in real values
```

Start the Postgres shards (either just the databases, or the full stack including the app):

```bash
docker compose up -d postgres_shard_1 postgres_shard_2 postgres_shard_3
# or, to also run the app in Docker:
docker compose up
```

> **Note:** `docker-compose.yml` hardcodes `SHARD_1_URL`/`SHARD_2_URL`/`SHARD_3_URL` under the
> `app` service's `environment:` block, in addition to loading `.env` via `env_file:`. When
> running under Docker, the compose file's inline values win over whatever is in your local
> `.env` — if you're pointing at different shard hosts, edit `docker-compose.yml` directly.

Apply migrations to every shard:

```bash
npm run migrate
```

Run the app:

```bash
npm run dev             # local dev server (tsx watch)
# or
npm run build && npm start   # compiled, production-style
```

Smoke test:

```bash
curl localhost:3000/health
```

## GCP Application Default Credentials (ADC)

Local development and the Docker container both authenticate to GCS via ADC rather than a
service-account JSON key:

```bash
gcloud auth application-default login
```

This writes credentials to `~/.config/gcloud/application_default_credentials.json`. In Docker,
that directory is mounted read-only into the app container
(`~/.config/gcloud:/root/.config/gcloud:ro` in `docker-compose.yml`), so the container picks up
the same credentials without ever holding a key file. `GCS_BUCKET_NAME` is required
(`src/gcloud/bucket.ts` throws at startup if unset); `GCP_PROJECT_ID` is optional and only needed
if ADC can't infer the project.

## Sharding Strategy

Shard assignment is application-level: `crc32(customer_id) % shardCount`
(`src/db/shardRouter.ts`), computed in Node and used to pick a `pg.Pool` before every write or
customer-scoped read. This was chosen over a single database or DB-native partitioning because:

- **Locality for customer history.** All of a customer's orders land on one shard, so
  `GET /orders?customerId=` is a single targeted query
  (`idx_orders_customer_date (customer_id, order_date DESC)`) — no cross-shard merge or sort.
- **Horizontal write scaling.** The 10k+ row CSV ingest fans out across N independent Postgres
  hosts instead of serializing through one, since shard assignment is a deterministic hash with
  no coordination needed between rows.

The trade-off: `order_id` is *not* the shard key, so a lookup by order ID can't be routed
directly — see below.

## Trade-offs & Architecture Decisions

**Streaming I/O for O(1) memory.** The upload handler
(`src/controllers/uploadOrders.controller.ts`) tees the incoming multipart file stream into two
branches — one piped straight to a GCS write stream, one through `fast-csv`'s streaming parser —
so the process never buffers the whole file in memory. Only per-shard row batches
(`ShardBufferManager`, `src/services/shardBuffer.service.ts`) are held before a bulk
`INSERT ... ON CONFLICT DO NOTHING` flush, and the CSV stream is paused/resumed around each flush
so buffered rows can't grow unbounded while a shard's insert is in flight.

**Scatter-gather for non-shard-key lookups.** `GET /orders/:orderId`
(`src/controllers/getOrderById.controller.ts`) can't know which shard holds a given order without
checking, since `order_id` isn't the hash key. It queries every shard pool in parallel
(`Promise.all`), takes the first (and only, since `order_id` is the primary key) match, and
returns 404 if no shard has it. Cheap at N=3; would need a shard-lookup index or a different
partitioning strategy to stay cheap at much larger N.

**Blocking ingestion response.** `POST /upload-orders` waits for the GCS write and all DB flushes
to complete before responding, returning `{ file, totalRows, successfulRows, failedRows,
rowErrors }`. This was a deliberate choice to give the caller real ingestion metrics in one
round-trip rather than a fire-and-forget `202` with no visibility into per-row outcomes.
