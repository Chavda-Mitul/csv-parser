import type { Server } from "http";
import { logger } from "./logger.js";
import { shardPools } from "./db/pool.js";

let server: Server | undefined;

export function setServer(instance: Server) {
  server = instance;
}

async function shutdown(exitCode: number) {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  await Promise.all(shardPools.map((pool) => pool.end()));
  process.exit(exitCode);
}

export function registerShutdownHandlers() {
  process.on("uncaughtException", (error) => {
    logger.fatal(error, "Uncaught exception, shutting down");
    void shutdown(1);
  });

  process.on("unhandledRejection", (reason) => {
    logger.fatal(reason, "Unhandled rejection, shutting down");
    void shutdown(1);
  });
}
