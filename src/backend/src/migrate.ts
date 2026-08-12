import { readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { Pool } from "pg";
import { shardPools } from "./db/pool.js";
import { logger } from "./logger.js";

const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations",
);

const migrations = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .sort();

async function migrateShard(pool: Pool, shardIndex: number) {
  const client = await pool.connect();

  try {
    // Create migration tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Get already applied migrations
    const { rows } = await client.query("SELECT name FROM schema_migrations");

    const applied = new Set(rows.map((row: { name: string }) => row.name));

    // Run migrations in order
    for (const migration of migrations) {
      if (applied.has(migration)) {
        continue;
      }

      logger.info({ shardIndex, migration }, "Applying migration");

      const sql = readFileSync(join(migrationsDir, migration), "utf8");

      await client.query("BEGIN");

      try {
        await client.query(sql);

        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [
          migration,
        ]);

        await client.query("COMMIT");

        logger.info({ shardIndex, migration }, "Applied migration");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    logger.info({ shardIndex }, "Migration complete");
  } finally {
    client.release();
  }
}

async function migrate() {
  try {
    // Run all shards in parallel
    await Promise.all(
      shardPools.map((pool, index) => migrateShard(pool, index)),
    );
    logger.info("All shards migrated successfully");
  } catch (error) {
    logger.error({ err: error }, "Migration failed");
    process.exit(1);
  } finally {
    // Close all database pools
    await Promise.all(shardPools.map((pool) => pool.end()));
  }
}

migrate();
