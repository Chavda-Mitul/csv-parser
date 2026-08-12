import { shardPools } from "./db/pool.js";

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: npm run query -- "SELECT COUNT(*) FROM orders;"');
  process.exit(1);
}
const sql: string = arg;

async function run() {
  try {
    for (const [index, pool] of shardPools.entries()) {
      const { rows } = await pool.query<Record<string, unknown>>(sql);
      console.log(`\n-- shard ${index} --`);
      console.table(rows);
    }
  } catch (error) {
    console.error(error);
    process.exit(1);
  } finally {
    await Promise.all(shardPools.map((pool) => pool.end()));
  }
}

run();
