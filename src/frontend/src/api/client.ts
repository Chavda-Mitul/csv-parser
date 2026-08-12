import type { ApiErrorBody, OrderRow, UploadJobEnqueued, UploadJobStatus } from "./types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function getHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export function uploadOrders(
  file: File,
  onProgress: (percent: number) => void,
): Promise<UploadJobEnqueued> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE_URL}/upload-orders`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };

    xhr.onload = () => {
      let body: unknown;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = {};
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as UploadJobEnqueued);
      } else {
        reject(new ApiError(xhr.status, (body as ApiErrorBody).error ?? "Upload failed"));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, "Network error during upload"));

    xhr.send(form);
  });
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, (body as ApiErrorBody).error ?? "Request failed");
  }
  return body as T;
}

export function getOrdersByCustomer(customerId: string): Promise<OrderRow[]> {
  return getJson<OrderRow[]>(`${API_BASE_URL}/orders?customerId=${encodeURIComponent(customerId)}`);
}

export function getOrderById(orderId: string): Promise<OrderRow> {
  return getJson<OrderRow>(`${API_BASE_URL}/orders/${encodeURIComponent(orderId)}`);
}

export function getUploadJobStatus(jobId: string): Promise<UploadJobStatus> {
  return getJson<UploadJobStatus>(`${API_BASE_URL}/upload-orders/${encodeURIComponent(jobId)}`);
}
