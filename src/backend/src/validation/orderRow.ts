import { z } from "zod";

export const MAX_FILE_BYTES = 500 * 1024 * 1024; // 500MB

export const fileInfoSchema = z.object({
  filename: z.string().toLowerCase().endsWith(".csv"),
  mimeType: z.enum(["text/csv", "application/vnd.ms-excel", "application/csv"]),
});

export const initUploadSchema = fileInfoSchema.extend({
  size: z.number().int().positive().max(MAX_FILE_BYTES),
});

export const completeUploadSchema = fileInfoSchema.extend({
  stagingPath: z.string().min(1),
});

export const orderRowSchema = z.object({
  order_id: z.string().trim().min(1),
  customer_id: z.string().trim().min(1),
  order_amount: z.coerce.number().positive(),
  order_date: z.coerce.date(),
  status: z.string().trim().min(1).default("PENDING"),
});
export type OrderRow = z.infer<typeof orderRowSchema>;
