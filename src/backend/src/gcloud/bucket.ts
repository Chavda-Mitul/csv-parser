import { Storage } from '@google-cloud/storage';
import { logger } from '../logger.js';

const { GCP_PROJECT_ID, GCS_BUCKET_NAME } = process.env;

if (!GCS_BUCKET_NAME) {
  throw new Error('GCS_BUCKET_NAME environment variable is required');
}

const storage = new Storage(
  GCP_PROJECT_ID ? { projectId: GCP_PROJECT_ID } : {},
);

const bucket = storage.bucket(GCS_BUCKET_NAME);

// Upload function example
async function uploadToGCS(filePath: string, destinationFileName: string) {
  await bucket.upload(filePath, {
    destination: destinationFileName,
  });
  logger.info({ destinationFileName }, 'File uploaded successfully');
}