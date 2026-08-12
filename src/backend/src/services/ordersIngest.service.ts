import { randomUUID } from "crypto";
import { PassThrough, Readable } from "stream";
import { parse } from "fast-csv";
import { bucket } from "../gcloud/bucket.js";
import { logger } from "../logger.js";
import { metrics } from "../metrics.js";
import { AppError } from "../errors/AppError.js";
import { orderRowSchema } from "../validation/orderRow.js";
import { ShardBufferManager } from "./shardBuffer.service.js";

export interface RowError {
  row: number;
  reason: string;
}

export interface UploadResult {
  file: string;
  totalRows: number;
  successfulRows: number;
  failedRows: number;
  rowErrors: RowError[];
}

// Lifted from the old synchronous uploadOrders.controller.ts: tee to GCS + CSV parse,
// validate rows, buffer/flush across shards. Now driven by any Readable (Busboy stream
// or, since uploads are staged to disk before queuing, fs.createReadStream) so the same
// pipeline runs identically whether called inline or from the pg-boss job handler.
export function ingestOrdersFile(
  fileStream: Readable,
  info: { filename: string; mimeType: string },
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const { filename, mimeType } = info;
    metrics.increment("uploadsStarted");
    logger.info({ filename, mimeType }, "Order file upload started");

    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

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
    const rowErrors: RowError[] = [];
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

    fileStream.on("error", (error) => {
      logger.error(error, "Failed to read staged upload file");
      gcsStream.destroy();
      csvStream.destroy();
      failUpload(new AppError(500, "Failed to read staged upload file"));
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
        resolve({ file: url, totalRows, successfulRows, failedRows, rowErrors });
      });
    };

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
}
