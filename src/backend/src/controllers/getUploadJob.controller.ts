import { z } from "zod";
import { AppError } from "../errors/AppError.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { boss } from "../db/pgBoss.js";
import { UPLOAD_ORDERS_QUEUE } from "../jobs/uploadOrders.job.js";
import type { UploadResult } from "../services/ordersIngest.service.js";

const paramsJobIdSchema = z.object({
  jobId: z.string().trim().min(1),
});

export const getUploadJob = asyncHandler(async (req, res) => {
  const result = paramsJobIdSchema.safeParse(req.params);
  if (!result.success) {
    throw new AppError(
      400,
      result.error.issues[0]?.message ?? "jobId is required",
    );
  }
  const { jobId } = result.data;

  const job = await boss.getJobById<UploadResult>(UPLOAD_ORDERS_QUEUE, jobId);
  if (!job) {
    throw new AppError(404, "Upload job not found");
  }

  if (job.state === "completed") {
    res.status(200).json({ jobId, status: "done", ...job.output });
    return;
  }

  if (job.state === "failed" || job.state === "cancelled") {
    const output = job.output as { message?: unknown } | undefined;
    const error =
      output && typeof output.message === "string"
        ? output.message
        : "Upload processing failed";
    res.status(200).json({ jobId, status: "error", error });
    return;
  }

  res.status(200).json({ jobId, status: "processing" });
});
