import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { env } from '../../../config/env.js';

// S3-COMPATIBLE object storage for bills (AWS S3, Cloudflare R2, MinIO...).
// Durable across redeploys, unlike the local filesystem on an ephemeral host.
// The storage key is used verbatim as the object key, so the same tenant-scoped
// "<companyId>/<month>/<uuid>.<ext>" layout and the company-prefix access check
// in the storage service apply unchanged. Credentials come only from the
// environment and never leave the backend.
//
// A missing object is signalled by throwing an error carrying `notFound: true`,
// matching the local provider's contract.

let client;

/** Lazily built so a local-storage deployment never opens an S3 connection. */
function s3() {
  if (!client) {
    client = new S3Client({
      region: env.BILL_S3_REGION,
      ...(env.BILL_S3_ENDPOINT ? { endpoint: env.BILL_S3_ENDPOINT } : {}),
      forcePathStyle: env.BILL_S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.BILL_S3_ACCESS_KEY_ID,
        secretAccessKey: env.BILL_S3_SECRET_ACCESS_KEY,
      },
    });
  }
  return client;
}

export async function put(storageKey, buffer, contentType) {
  await s3().send(
    new PutObjectCommand({
      Bucket: env.BILL_S3_BUCKET,
      Key: storageKey,
      Body: buffer,
      ContentType: contentType,
    }),
  );
}

/** True when an S3 error means "this object does not exist". Pure; unit-tested. */
export function isNotFoundError(error) {
  return error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404;
}

export async function get(storageKey) {
  try {
    const result = await s3().send(
      new GetObjectCommand({ Bucket: env.BILL_S3_BUCKET, Key: storageKey }),
    );
    return Buffer.from(await result.Body.transformToByteArray());
  } catch (error) {
    if (isNotFoundError(error)) {
      const missing = new Error('Stored bill file not found');
      missing.notFound = true;
      throw missing;
    }
    throw error;
  }
}

export async function remove(storageKey) {
  // S3 DeleteObject is idempotent: deleting a missing key succeeds.
  await s3().send(new DeleteObjectCommand({ Bucket: env.BILL_S3_BUCKET, Key: storageKey }));
}
