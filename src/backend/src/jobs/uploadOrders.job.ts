import { createReadStream } from "fs";
import { unlink } from "fs/promises";
import { boss } from "../db/pgBoss.js";
import { logger } from "../logger.js";
import { ingestOrdersFile } from "../services/ordersIngest.service.js";

export const UPLOAD_ORDERS_QUEUE = "upload-orders";

interface UploadOrdersJobData {
  tempFilePath: string;
  filename: string;
  mimeType: string;
}

export async function registerUploadOrdersWorker() {
  // retryLimit: 0 — ingestion failures (malformed CSV, bad rows) are deterministic on the
  // same staged file, and the temp file is deleted after the first attempt, so a retry
  // would just fail again with a confusing "file not found" instead of the real error.
  // updateQueue makes this take effect even if the queue already existed with different
  // settings (createQueue's options only apply the first time a queue is created).
  await boss.createQueue(UPLOAD_ORDERS_QUEUE, { retryLimit: 0 });
  await boss.updateQueue(UPLOAD_ORDERS_QUEUE, { retryLimit: 0 });

  await boss.work<UploadOrdersJobData>(UPLOAD_ORDERS_QUEUE, async (jobs) => {
    const job = jobs[0];
    if (!job) return;
    const { tempFilePath, filename, mimeType } = job.data;
    try {
      return await ingestOrdersFile(createReadStream(tempFilePath), {
        filename,
        mimeType,
      });
    } finally {
      await unlink(tempFilePath).catch((error) =>
        logger.warn(error, "Failed to remove staged upload file"),
      );
    }
  });
}
