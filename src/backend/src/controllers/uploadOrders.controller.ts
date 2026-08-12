import Busboy from "busboy";
import { randomUUID } from "crypto";
import { createWriteStream } from "fs";
import { unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { boss } from "../db/pgBoss.js";
import { logger } from "../logger.js";
import { AppError } from "../errors/AppError.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { fileInfoSchema } from "../validation/orderRow.js";
import { UPLOAD_ORDERS_QUEUE } from "../jobs/uploadOrders.job.js";

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50MB

// Receives and stages the upload only — the actual GCS backup + CSV parse + shard
// writes happen in the pg-boss job (src/jobs/uploadOrders.job.ts) so this request
// returns as soon as the file is safely on disk, instead of blocking for the full
// ingestion duration.
export const uploadOrders = asyncHandler((req, res) => {
  return new Promise<void>((resolve, reject) => {
    const busboy = Busboy({
      headers: req.headers,
      limits: { files: 1, fileSize: MAX_FILE_BYTES },
    });

    let handledFile = false;
    let settled = false;
    let stagingTempFilePath: string | undefined;

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

      const tempFilePath = join(
        tmpdir(),
        `upload-${randomUUID()}-${filename}`,
      );
      stagingTempFilePath = tempFilePath;
      const tempStream = createWriteStream(tempFilePath);

      fileStream.on("limit", () => {
        tempStream.destroy();
        void unlink(tempFilePath).catch(() => {});
        settle(() =>
          reject(
            new AppError(
              413,
              `File exceeds maximum size of ${MAX_FILE_BYTES} bytes`,
            ),
          ),
        );
      });

      tempStream.on("error", (error) => {
        logger.error(error, "Failed to stage uploaded file");
        void unlink(tempFilePath).catch(() => {});
        settle(() =>
          reject(new AppError(500, "Failed to stage uploaded file")),
        );
      });

      tempStream.on("finish", () => {
        settle(() => {
          boss
            .send(UPLOAD_ORDERS_QUEUE, { tempFilePath, filename, mimeType })
            .then((jobId) => {
              if (!jobId) {
                throw new Error("boss.send returned no jobId");
              }
              stagingTempFilePath = undefined;
              res.status(202).json({ jobId });
              resolve();
            })
            .catch((error: unknown) => {
              logger.error(error, "Failed to enqueue upload job");
              void unlink(tempFilePath).catch(() => {});
              reject(new AppError(500, "Failed to queue upload"));
            });
        });
      });

      fileStream.pipe(tempStream);
    });

    busboy.on("error", () => {
      if (stagingTempFilePath) {
        void unlink(stagingTempFilePath).catch(() => {});
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
