import Busboy from "busboy";
import { randomUUID } from "crypto";
import { z } from "zod";
import { bucket } from "../gcloud/bucket.js";
import { logger } from "../logger.js";
import { AppError } from "../errors/AppError.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50MB

const fileInfoSchema = z.object({
  filename: z.string().toLowerCase().endsWith(".csv"),
  mimeType: z.enum(["text/csv", "application/vnd.ms-excel", "application/csv"]),
});

export const uploadOrders = asyncHandler((req, res) => {
  return new Promise<void>((resolve, reject) => {
    const busboy = Busboy({
      headers: req.headers,
      limits: { files: 1, fileSize: MAX_FILE_BYTES },
    });

    let handledFile = false;
    let settled = false;

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

      const destination = `orders/${randomUUID()}-${filename}`;
      const gcsStream = bucket
        .file(destination)
        .createWriteStream({ contentType: mimeType });

      fileStream.on("limit", () => {
        gcsStream.destroy();
        settle(() =>
          reject(
            new AppError(
              413,
              `File exceeds maximum size of ${MAX_FILE_BYTES} bytes`,
            ),
          ),
        );
      });

      gcsStream.on("error", (error) => {
        logger.error(error, "Failed to upload file to GCS");
        settle(() => reject(new AppError(502, "Failed to store file")));
      });

      gcsStream.on("finish", () => {
        settle(() => {
          logger.info({ destination }, "Order file uploaded");
          res.status(202).json({ file: destination });
          resolve();
        });
      });

      fileStream.pipe(gcsStream);
    });

    busboy.on("error", () => {
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
