import Busboy from "busboy";
import { randomUUID } from "crypto";
import { PassThrough } from "stream";
import { parse } from "fast-csv";
import { bucket } from "../gcloud/bucket.js";
import { logger } from "../logger.js";
import { metrics } from "../metrics.js";
import { AppError } from "../errors/AppError.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { fileInfoSchema, orderRowSchema } from "../validation/orderRow.js";
import { ShardBufferManager } from "../services/shardBuffer.service.js";

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50MB

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
      metrics.increment("uploadsStarted");
      logger.info({ filename, mimeType }, "Order file upload started");

      const failUpload = (error: AppError) => {
        metrics.increment("uploadsFailed");
        settle(() => reject(error));
      };

      const destination = `orders/${randomUUID()}-${filename}`;
      const gcsFile = bucket.file(destination);
      const gcsStream = gcsFile.createWriteStream({ contentType: mimeType });

      const branchA = new PassThrough();
      const branchB = new PassThrough();
      fileStream.pipe(branchA);
      fileStream.pipe(branchB);

      const csvStream = branchB.pipe(parse({ headers: true }));
      let totalRows = 0;
      let successfulRows = 0;
      let failedRows = 0;
      const rowErrors: { row: number; reason: string }[] = [];
      const shardBuffers = new ShardBufferManager();

      let checkedMagic = false;
      fileStream.on("data", (chunk: Buffer) => {
        if (checkedMagic) return;
        checkedMagic = true;
        if (chunk.subarray(0, 512).includes(0)) {
          gcsStream.destroy();
          csvStream.destroy();
          failUpload(
            new AppError(400, "File does not appear to be a valid CSV"),
          );
        }
      });

      csvStream.on("data", (row) => {
        totalRows++;
        const result = orderRowSchema.safeParse(row);
        if (!result.success) {
          failedRows++;
          const reason = result.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; ");
          rowErrors.push({ row: totalRows, reason });
          logger.warn({ row: totalRows, reason }, "Skipping invalid order row");
          return;
        }
        successfulRows++;
        const targetShardIdx = shardBuffers.add(result.data);

        const handleFlushError = (error: unknown) => {
          logger.error(error, "Failed to bulk insert order batch");
          gcsStream.destroy();
          csvStream.destroy();
          failUpload(new AppError(502, "Failed to write orders to database"));
        };

        if (shardBuffers.isFull(targetShardIdx)) {
          shardBuffers.flushAsync(targetShardIdx).catch(handleFlushError);
        }

        if (shardBuffers.needsBackpressure(targetShardIdx)) {
          csvStream.pause();
          shardBuffers
            .waitFor(targetShardIdx)
            .then(() => csvStream.resume())
            .catch(() => {
              // already handled by handleFlushError above
            });
        }
      });

      let gcsDone = false;
      let csvDone = false;
      const maybeFinish = () => {
        if (!gcsDone || !csvDone) return;
        settle(() => {
          const url = gcsFile.publicUrl();
          metrics.increment("uploadsSucceeded");
          metrics.increment("rowsIngested", successfulRows);
          metrics.increment("rowsFailed", failedRows);
          logger.info(
            { destination, url, totalRows, successfulRows, failedRows },
            "Order file uploaded",
          );
          res.status(200).json({
            file: url,
            totalRows,
            successfulRows,
            failedRows,
            rowErrors,
          });
          resolve();
        });
      };

      fileStream.on("limit", () => {
        gcsStream.destroy();
        csvStream.destroy();
        failUpload(
          new AppError(
            413,
            `File exceeds maximum size of ${MAX_FILE_BYTES} bytes`,
          ),
        );
      });

      gcsStream.on("error", (error) => {
        logger.error(error, "Failed to upload file to GCS");
        csvStream.destroy();
        failUpload(new AppError(502, "Failed to store file"));
      });

      csvStream.on("error", (error) => {
        logger.error(error, "Failed to parse CSV file");
        gcsStream.destroy();
        failUpload(new AppError(400, "Malformed CSV file"));
      });

      gcsStream.on("finish", () => {
        gcsDone = true;
        maybeFinish();
      });

      csvStream.on("end", () => {
        shardBuffers
          .flushAll()
          .then(() => {
            csvDone = true;
            maybeFinish();
          })
          .catch((error: unknown) => {
            logger.error(error, "Failed to flush final order batch");
            gcsStream.destroy();
            failUpload(new AppError(502, "Failed to write orders to database"));
          });
      });

      branchA.pipe(gcsStream);
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
