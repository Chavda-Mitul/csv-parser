import { randomUUID } from "crypto";
import type { File } from "@google-cloud/storage";
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

interface ParseResult {
  totalRows: number;
  successfulRows: number;
  failedRows: number;
  rowErrors: RowError[];
}

// Parses/validates the staged CSV and buffers valid rows out to shards.
function parseAndIngest(sourceFile: File): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    const fail = (error: AppError) => settle(() => reject(error));

    const fileStream = sourceFile.createReadStream();
    const csvStream = fileStream.pipe(parse({ headers: true }));
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
        csvStream.destroy();
        fail(new AppError(400, "File does not appear to be a valid CSV"));
      }
    });

    fileStream.on("error", (error) => {
      logger.error(error, "Failed to read staged upload file");
      csvStream.destroy();
      fail(new AppError(500, "Failed to read staged upload file"));
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
        csvStream.destroy();
        fail(new AppError(502, "Failed to write orders to database"));
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

    csvStream.on("error", (error) => {
      logger.error(error, "Failed to parse CSV file");
      fail(new AppError(400, "Malformed CSV file"));
    });

    csvStream.on("end", () => {
      shardBuffers
        .flushAll()
        .then(() => settle(() => resolve({ totalRows, successfulRows, failedRows, rowErrors })))
        .catch((error: unknown) => {
          logger.error(error, "Failed to flush final order batch");
          fail(new AppError(502, "Failed to write orders to database"));
        });
    });
  });
}

// The staged upload already lives in GCS (client PUT it there via a signed URL), so the
// permanent backup is a server-side copy — no bytes round-trip through this process — run
// in parallel with CSV parsing/validation/shard writes off the same staged object.
export async function ingestOrdersFile(
  sourceFile: File,
  info: { filename: string; mimeType: string },
): Promise<UploadResult> {
  const { filename, mimeType } = info;
  metrics.increment("uploadsStarted");
  logger.info({ filename, mimeType }, "Order file upload started");

  const destination = `orders/${randomUUID()}-${filename}`;
  const destFile = bucket.file(destination);

  try {
    const [, parseResult] = await Promise.all([
      sourceFile.copy(destFile).catch((error: unknown) => {
        logger.error(error, "Failed to copy file to permanent storage");
        throw new AppError(502, "Failed to store file");
      }),
      parseAndIngest(sourceFile),
    ]);

    const url = destFile.publicUrl();
    metrics.increment("uploadsSucceeded");
    metrics.increment("rowsIngested", parseResult.successfulRows);
    metrics.increment("rowsFailed", parseResult.failedRows);
    logger.info({ destination, url, ...parseResult }, "Order file uploaded");
    return { file: url, ...parseResult };
  } catch (error) {
    metrics.increment("uploadsFailed");
    await destFile.delete().catch(() => {
      // best-effort cleanup of a partial/orphaned backup
    });
    throw error;
  }
}
