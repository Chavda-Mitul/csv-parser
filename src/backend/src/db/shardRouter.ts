import type { Pool } from "pg";
import { crc32 } from "zlib";
import { shardPools } from "./pool.js";

export function getShardPool(shardIndex: number): Pool {
  const pool = shardPools[shardIndex];
  if (!pool) throw new Error(`No shard pool at index ${shardIndex}`);
  return pool;
}

export function getShardCount(): number {
  return shardPools.length;
}

export function getShardIndexForCustomer(customerId: string): number {
  const checksum = crc32(Buffer.from(customerId));
  return checksum % shardPools.length;
}

export function getShardPoolForCustomer(customerId: string): Pool {
  return getShardPool(getShardIndexForCustomer(customerId));
}
