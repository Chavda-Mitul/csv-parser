import Busboy from "busboy";
import { randomUUID } from "crypto";
import { boss } from "../db/pgBoss.js";
import { bucket } from "../gcloud/bucket.js";
import { logger } from "../logger.js";
import { AppError } from "../errors/AppError.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { fileInfoSchema } from "../validation/orderRow.js";
import { UPLOAD_ORDERS_QUEUE } from "../jobs/uploadOrders.job.js";

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50MB

// Receives and stages the upload only — the actual GCS backup + CSV parse + shard
// writes happen in the pg-boss job (src/jobs/uploadOrders.job.ts) so this request
// returns as soon as the file is safely staged, instead of blocking for the full
// ingestion duration. Staged to GCS rather than local disk: the pg-boss worker that
// picks up the job can run on a different instance than the one that handled this
// request (Cloud Run scales to multiple instances, each running its own worker), so
// a local temp file wouldn't be visible to whichever instance processes the job.
export const uploadOrders = asyncHandler((req, res) => {
  return new Promise<void>((resolve, reject) => {
    const busboy = Busboy({
      headers: req.headers,
      limits: { files: 1, fileSize: MAX_FILE_BYTES },
    });

    let handledFile = false;
    let settled = false;
    let stagingFile: ReturnType<typeof bucket.file> | undefined;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      req.unpipe(busboy);
      busboy.removeAllListeners();
      fn();
    };

    busboy.on("file", (_fieldname, fileStream, info) => {
      handledFile = true;

      const parsed = fileInfoSchema.safeParse(info);
      if (!parsed.success) {
        fileStream.resume();
        return settle(() =>
          reject(new AppError(400, "Only CSV files are accepted")),
        );
      }
      const { filename, mimeType } = parsed.data;

      const stagingPath = `staging/${randomUUID()}-${filename}`;
      const gcsFile = bucket.file(stagingPath);
      stagingFile = gcsFile;
      const stagingStream = gcsFile.createWriteStream({ contentType: mimeType });

      fileStream.on("limit", () => {
        stagingStream.destroy();
        void gcsFile.delete().catch(() => {});
        settle(() =>
          reject(
            new AppError(
              413,
              `File exceeds maximum size of ${MAX_FILE_BYTES} bytes`,
            ),
          ),
        );
      });

      stagingStream.on("error", (error) => {
        logger.error(error, "Failed to stage uploaded file");
        void gcsFile.delete().catch(() => {});
        settle(() =>
          reject(new AppError(500, "Failed to stage uploaded file")),
        );
      });

      stagingStream.on("finish", () => {
        settle(() => {
          boss
            .send(UPLOAD_ORDERS_QUEUE, { stagingPath, filename, mimeType })
            .then((jobId) => {
              if (!jobId) {
                throw new Error("boss.send returned no jobId");
              }
              stagingFile = undefined;
              res.status(202).json({ jobId });
              resolve();
            })
            .catch((error: unknown) => {
              logger.error(error, "Failed to enqueue upload job");
              void gcsFile.delete().catch(() => {});
              reject(new AppError(500, "Failed to queue upload"));
            });
        });
      });

      fileStream.pipe(stagingStream);
    });

    busboy.on("error", () => {
      if (stagingFile) {
        void stagingFile.delete().catch(() => {});
      }
      settle(() => reject(new AppError(400, "Invalid multipart upload")));
    });

    busboy.on("close", () => {
      if (!handledFile) {
        settle(() =>
          reject(new AppError(400, "No file field found in upload")),
        );
      }
    });

    req.pipe(busboy);
  });
});
