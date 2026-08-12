# High-Throughput Sharded Order Ingestion Engine

**Role / Context:** Backend Engineering Assessment Implementation
**Tech Stack:** Node.js (Express 5), PostgreSQL, Google Cloud Storage (GCS), Docker

## Target Design

Ingest large CSV order files (~10k+ records) via streams, back the raw file up to GCS,
validate rows on the fly, and fan valid rows out across N sharded PostgreSQL instances
using CRC32(customer_id) % N. Bulk-insert per shard with backpressure. Expose lookup by
customer and by order ID (scatter-gather).

Target schema (`migrations/001_create_orders.sql`):
```sql
CREATE TABLE IF NOT EXISTS orders (
    order_id VARCHAR(36) PRIMARY KEY,
    customer_id VARCHAR(64) NOT NULL,
    order_date TIMESTAMPTZ NOT NULL,
    order_amount NUMERIC(12, 2) NOT NULL CHECK (order_amount >= 0),
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_orders_customer_date ON orders (customer_id, order_date DESC);
```

## Built so far

- **Server scaffold** (`server.ts`): Express app, `/health`, central error handler
  (`middleware/errorHandler.ts`), 404 handler, graceful shutdown on
  `uncaughtException`/`unhandledRejection` (`shutdown.ts`).
- **Sharded pool setup** (`db/pool.ts`): discovers `SHARD_<n>_URL` env vars, builds one `pg.Pool`
  per shard, numeric-sorted by index.
- **Shard routing** (`db/shardRouter.ts`): `crc32(customer_id) % shardCount` via Node's built-in
  `zlib.crc32` — matches the spec's hashing scheme.
- **Migration runner** (`migrate.ts`): applies `migrations/*.sql` to every shard in parallel,
  tracked per-shard in a `schema_migrations` table. One migration exists
  (`001_create_orders.sql`, the schema above).
- **Upload endpoint** (`POST /upload-orders`, `routes/orders.routes.ts` →
  `controllers/uploadOrders.controller.ts`): multipart upload via `busboy`, validates
  content-type header (`middleware/validateUpload.ts`) and filename/mimetype (zod), streams the
  file straight to GCS (`gcloud/bucket.ts`, ADC-based), enforces a 50MB cap, responds
  `202 { file: destination }` once the GCS write finishes.
- **Docker Compose**: app + 3 Postgres shard containers, ADC creds mounted read-only.

## Not built yet

This is the gap between what exists and the spec above — the CSV parsing/sharding/ingestion
pipeline, which is the actual point of the assessment, hasn't started:

- **No CSV parsing.** `fast-csv` isn't even in `package.json`. The upload handler only pipes to
  GCS (Branch A) — there's no Branch B parser splitting the stream.
- **No row validation** (order_id, customer_id, order_date, order_amount type/shape checks).
- **No DLQ / malformed-row logging or skip-and-continue behavior.**
- **No shard buffering or batch flush logic** (`shardBuffers[shardIdx]`, capacity-triggered flush).
- **No bulk insert.** `pg-format` isn't in `package.json` either — no
  `INSERT ... ON CONFLICT DO NOTHING` path exists.
- **No backpressure** (`pause()`/`resume()`) — moot until parsing exists.
- **No `GET /orders?customerId=`** endpoint.
- **No `GET /orders/:orderId`** scatter-gather endpoint.
- **No ingestion metrics in the response** — upload currently returns as soon as the GCS write
  finishes, not after DB ingestion; there's no processed/skipped count or per-row outcome.

In short: file-to-GCS backup, shard pool/routing plumbing, and migrations are done. The actual
ingestion pipeline (parse → validate → shard → batch insert) and both read endpoints are 0%.

## Things worth double-checking (not necessarily bugs, but flagged)

- `middleware/validateUpload.ts` only checks the `content-type` header starts with
  `multipart/form-data` — actual file validation (extension, mimetype) happens later inside the
  controller via `fileInfoSchema`. Fine, just note the split isn't obvious from the route alone.
- `fileInfoSchema`'s mimetype allowlist (`text/csv`, `application/vnd.ms-excel`,
  `application/csv`) trusts the client-supplied `Content-Type` for the *part*, not the file's
  actual bytes. Acceptable for an internal tool, but not a real content-type sniff.
- `docker-compose.yml` hardcodes `SHARD_1_URL`/`SHARD_2_URL`/`SHARD_3_URL` in `environment:` *and*
  loads `.env` via `env_file:` — if your local `.env` defines different shard URLs (e.g. for
  running outside Docker), the compose-file values win when running under Docker. Easy to get
  confused about which one is actually in effect.
- Once ingestion is added, the upload response contract will need to change (currently returns as
  soon as the GCS branch finishes) — decide whether `POST /upload-orders` should stay
  fire-and-forget (202 immediately, DB ingestion happens async) or block until ingestion
  completes and return real metrics. The spec's step 5 implies the latter; the current 202 shape
  implies the former. Worth deciding before building the parser so the response contract doesn't
  need reshaping twice.
