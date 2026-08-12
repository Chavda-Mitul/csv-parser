import { PgBoss } from "pg-boss";
import "dotenv/config";

const connectionString = process.env.PGBOSS_URL;
if (!connectionString) {
  throw new Error("PGBOSS_URL environment variable is required");
}

export const boss = new PgBoss(connectionString);
