import { boss } from "../db/pgBoss.js";
import { bucket } from "../gcloud/bucket.js";
import { logger } from "../logger.js";
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

  await boss.work<UploadOrdersJobData>(UPLOAD_ORDERS_QUEUE, async (jobs) => {
    const job = jobs[0];
    if (!job) return;
    const { stagingPath, filename, mimeType } = job.data;
    const stagingFile = bucket.file(stagingPath);
    try {
      return await ingestOrdersFile(stagingFile.createReadStream(), {
        filename,
        mimeType,
      });
    } finally {
      await stagingFile
        .delete()
        .catch((error) =>
          logger.warn(error, "Failed to remove staged upload file"),
        );
    }
  });
}
