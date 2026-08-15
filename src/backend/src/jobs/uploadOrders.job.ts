import { boss } from "../db/pgBoss.js";
import { bucket } from "../gcloud/bucket.js";
import { logger } from "../logger.js";
import { AppError } from "../errors/AppError.js";
import { MAX_FILE_BYTES } from "../validation/orderRow.js";
import { ingestOrdersFile } from "../services/ordersIngest.service.js";

export const UPLOAD_ORDERS_QUEUE = "upload-orders";

interface UploadOrdersJobData {
  stagingPath: string;
  filename: string;
  mimeType: string;
}

export async function registerUploadOrdersWorker() {
  // retryLimit: 0 — ingestion failures (malformed CSV, bad rows) are deterministic on the
  // same staged file, and the staged file is deleted after the first attempt, so a retry
  // would just fail again with a confusing "file not found" instead of the real error.
  // updateQueue makes this take effect even if the queue already existed with different
  // settings (createQueue's options only apply the first time a queue is created).
  await boss.createQueue(UPLOAD_ORDERS_QUEUE, { retryLimit: 0 });
  await boss.updateQueue(UPLOAD_ORDERS_QUEUE, { retryLimit: 0 });

  // localConcurrency: 5 — lets this instance process up to 5 upload jobs at once instead
  // of pg-boss's default of 1. Ingestion is I/O-bound (GCS reads, Postgres writes), so
  // concurrent jobs interleave during each other's network waits rather than competing for
  // CPU. Paired with each shard pool's connection limit (`pool.ts`) — don't raise this
  // without also checking pool size, or jobs just queue for a DB connection instead.
  await boss.work<UploadOrdersJobData>(UPLOAD_ORDERS_QUEUE, { localConcurrency: 5 }, async (jobs) => {
    const job = jobs[0];
    if (!job) return;
    const { stagingPath, filename, mimeType } = job.data;
    const stagingFile = bucket.file(stagingPath);
    try {
      // The signed-URL upload isn't stream-limited like the old Busboy path was, so this is
      // the real enforcement point for MAX_FILE_BYTES (the `size` field checked at init time
      // is only client-declared, not trustworthy).
      const [{ size }] = await stagingFile.getMetadata();
      if (Number(size) > MAX_FILE_BYTES) {
        throw new AppError(413, `File exceeds maximum size of ${MAX_FILE_BYTES} bytes`);
      }

      return await ingestOrdersFile(stagingFile, { filename, mimeType });
    } finally {
      await stagingFile
        .delete()
        .catch((error) =>
          logger.warn(error, "Failed to remove staged upload file"),
        );
    }
  });
}
