import type { ApiErrorBody, OrderRow, UploadJobEnqueued, UploadJobStatus } from "./types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";
const API_KEY = import.meta.env.VITE_API_KEY ?? "";

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

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
    body: JSON.stringify(body),
  });
  const responseBody = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, (responseBody as ApiErrorBody).error ?? "Request failed");
  }
  return responseBody as T;
}

function putToSignedUrl(
  uploadUrl: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", file.type);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new ApiError(xhr.status, "Upload to storage failed"));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, "Network error during upload"));

    xhr.send(file);
  });
}

// Cloud Run caps request bodies at 32MiB, so the file never passes through our backend:
// init mints a signed GCS URL, the browser PUTs the file straight to storage, then complete
// tells the backend to enqueue ingestion.
export async function uploadOrders(
  file: File,
  onProgress: (percent: number) => void,
): Promise<UploadJobEnqueued> {
  const { uploadUrl, stagingPath } = await postJson<{ uploadUrl: string; stagingPath: string }>(
    `${API_BASE_URL}/upload-orders/init`,
    { filename: file.name, mimeType: file.type, size: file.size },
  );

  await putToSignedUrl(uploadUrl, file, onProgress);

  return postJson<UploadJobEnqueued>(`${API_BASE_URL}/upload-orders/complete`, {
    stagingPath,
    filename: file.name,
    mimeType: file.type,
  });
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "x-api-key": API_KEY } });
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
