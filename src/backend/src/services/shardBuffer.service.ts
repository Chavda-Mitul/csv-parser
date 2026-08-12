import {
  getShardCount,
  getShardIndexForCustomer,
  getShardPool,
} from "../db/shardRouter.js";
import type { OrderRow } from "../validation/orderRow.js";

export const BATCH_SIZE = 500;

export class ShardBufferManager {
  private buffers: OrderRow[][] = Array.from(
    { length: getShardCount() },
    () => [],
  );
  // ponytail: one in-flight flush per shard, tracked so shards don't block each other
  private inFlight: (Promise<void> | null)[] = Array.from(
    { length: getShardCount() },
    () => null,
  );

  add(row: OrderRow): number {
    const shardIdx = getShardIndexForCustomer(row.customer_id);
    this.buffers[shardIdx]!.push(row);
    return shardIdx;
  }

  isFull(shardIdx: number): boolean {
    return this.buffers[shardIdx]!.length >= BATCH_SIZE;
  }

  // true once a second full batch has piled up behind an in-flight flush —
  // only then is it worth pausing the whole CSV stream
  needsBackpressure(shardIdx: number): boolean {
    return this.buffers[shardIdx]!.length >= BATCH_SIZE * 2;
  }

  private async doFlush(shardIdx: number): Promise<void> {
    const buffer = this.buffers[shardIdx]!;
    if (buffer.length === 0) return;
    const batch = buffer.splice(0, buffer.length);
    const values: unknown[] = [];
    const placeholders = batch.map((row, i) => {
      const base = i * 5;
      values.push(row.order_id, row.customer_id, row.order_date, row.order_amount, row.status);
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
    });
    const sql = `INSERT INTO orders (order_id, customer_id, order_date, order_amount, status) VALUES ${placeholders.join(", ")} ON CONFLICT (order_id) DO NOTHING`;
    await getShardPool(shardIdx).query(sql, values);
  }

  // fires a shard's flush without blocking other shards; a second call while
  // one is already running just returns the same in-flight promise
  flushAsync(shardIdx: number): Promise<void> {
    if (!this.inFlight[shardIdx]) {
      this.inFlight[shardIdx] = this.doFlush(shardIdx).finally(() => {
        this.inFlight[shardIdx] = null;
      });
    }
    return this.inFlight[shardIdx]!;
  }

  waitFor(shardIdx: number): Promise<void> {
    return this.inFlight[shardIdx] ?? Promise.resolve();
  }

  async flushAll(): Promise<void> {
    await Promise.all(
      this.inFlight.filter((p): p is Promise<void> => p !== null),
    );
    await Promise.all(this.buffers.map((_, idx) => this.doFlush(idx)));
  }
}
