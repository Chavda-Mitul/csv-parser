import { z } from "zod";

export const fileInfoSchema = z.object({
  filename: z.string().toLowerCase().endsWith(".csv"),
  mimeType: z.enum(["text/csv", "application/vnd.ms-excel", "application/csv"]),
});

export const orderRowSchema = z.object({
  order_id: z.string().trim().min(1),
  customer_id: z.string().trim().min(1),
  order_amount: z.coerce.number().positive(),
  order_date: z.coerce.date(),
});
export type OrderRow = z.infer<typeof orderRowSchema>;
