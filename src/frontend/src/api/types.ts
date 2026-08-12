// Shapes mirror the actual backend responses (uploadOrders/getOrders/getOrderById controllers),
// not the aspirational spec — the backend doesn't return orderId/rawRow per error or a status/metrics envelope.

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

export interface OrderRow {
  order_id: string;
  customer_id: string;
  order_date: string;
  order_amount: string;
  status: string;
  created_at: string;
}

export interface ApiErrorBody {
  error?: string;
}

export interface UploadJobEnqueued {
  jobId: string;
}

export type UploadJobStatus =
  | { jobId: string; status: "processing" }
  | ({ jobId: string; status: "done" } & UploadResult)
  | { jobId: string; status: "error"; error: string };
