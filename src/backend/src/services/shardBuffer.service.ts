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

  add(row: OrderRow): number {
    const shardIdx = getShardIndexForCustomer(row.customer_id);
    this.buffers[shardIdx]!.push(row);
    return shardIdx;
  }

  isFull(shardIdx: number): boolean {
    return this.buffers[shardIdx]!.length >= BATCH_SIZE;
  }

  async flush(shardIdx: number): Promise<void> {
    const buffer = this.buffers[shardIdx]!;
    if (buffer.length === 0) return;
    const batch = buffer.splice(0, buffer.length);
    const values: unknown[] = [];
    const placeholders = batch.map((row, i) => {
      const base = i * 4;
      values.push(row.order_id, row.customer_id, row.order_date, row.order_amount);
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
    });
    const sql = `INSERT INTO orders (order_id, customer_id, order_date, order_amount) VALUES ${placeholders.join(", ")} ON CONFLICT (order_id) DO NOTHING`;
    await getShardPool(shardIdx).query(sql, values);
  }

  async flushAll(): Promise<void> {
    await Promise.all(this.buffers.map((_, idx) => this.flush(idx)));
  }
}
