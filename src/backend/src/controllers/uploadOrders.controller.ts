import { randomUUID } from "crypto";
import { boss } from "../db/pgBoss.js";
import { bucket } from "../gcloud/bucket.js";
import { logger } from "../logger.js";
import { AppError } from "../errors/AppError.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { initUploadSchema, completeUploadSchema } from "../validation/orderRow.js";
import { UPLOAD_ORDERS_QUEUE } from "../jobs/uploadOrders.job.js";

const SIGNED_URL_TTL_MS = 15 * 60 * 1000;

export const initUpload = asyncHandler(async (req, res) => {
  const parsed = initUploadSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError(400, parsed.error.issues[0]?.message ?? "Invalid request");
  }
  const { filename, mimeType } = parsed.data;

  const stagingPath = `staging/${randomUUID()}-${filename}`;
  const [uploadUrl] = await bucket.file(stagingPath).getSignedUrl({
    version: "v4",
    action: "write",
    expires: Date.now() + SIGNED_URL_TTL_MS,
    contentType: mimeType,
  });

  res.status(200).json({ uploadUrl, stagingPath });
});

export const completeUpload = asyncHandler(async (req, res) => {
  const parsed = completeUploadSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError(400, parsed.error.issues[0]?.message ?? "Invalid request");
  }
  const { stagingPath, filename, mimeType } = parsed.data;

  const jobId = await boss.send(UPLOAD_ORDERS_QUEUE, { stagingPath, filename, mimeType });
  if (!jobId) {
    logger.error({ stagingPath }, "boss.send returned no jobId");
    throw new AppError(500, "Failed to queue upload");
  }

  res.status(202).json({ jobId });
});
