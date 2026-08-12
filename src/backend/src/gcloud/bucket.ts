import { Storage } from "@google-cloud/storage";

const { GCP_PROJECT_ID, GCS_BUCKET_NAME } = process.env;

if (!GCS_BUCKET_NAME) {
  throw new Error("GCS_BUCKET_NAME environment variable is required");
}

const storage = new Storage(
  GCP_PROJECT_ID ? { projectId: GCP_PROJECT_ID } : {},
);

export const bucket = storage.bucket(GCS_BUCKET_NAME);
