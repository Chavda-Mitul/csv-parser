import { Pool } from "pg";
import { crc32 } from "zlib";
import "dotenv/config";

const shardUrls = Object.entries(process.env)
  .filter(([key]) => /^SHARD_\d+_URL$/.test(key))
  .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
  .map(([, url]) => url as string);

if (shardUrls.length === 0) throw new Error("No SHARD_*_URL env vars found");

export const shardPools: Pool[] = shardUrls.map((connectionString) => new Pool({ connectionString }));

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
