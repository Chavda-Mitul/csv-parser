import { Pool } from "pg";
import "dotenv/config";

const shardUrls = Object.entries(process.env)
  .filter(([key]) => /^SHARD_\d+_URL$/.test(key))
  .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
  .map(([, url]) => url as string);

if (shardUrls.length === 0) throw new Error("No SHARD_*_URL env vars found");

export const shardPools: Pool[] = shardUrls.map(
  (connectionString) => new Pool({ connectionString }),
);

export async function connectDB(): Promise<void> {
  await Promise.all(shardPools.map((pool) => pool.query("SELECT 1")));
}
