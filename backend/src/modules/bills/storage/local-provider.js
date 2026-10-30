import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../../config/env.js';
import { ApiError } from '../../../utils/api-error.js';

// LOCAL FILESYSTEM storage for bills: the default, used in development and on a
// host with a persistent disk. On an ephemeral filesystem (e.g. Render's default
// instances) files are lost on redeploy - use the S3 provider there instead.
//
// A missing file is signalled by throwing an error carrying `notFound: true`, so
// the storage service can map it to a friendly "upload again" response without
// coupling to any provider's error shape.

/** Absolute path for a key, refusing anything that escapes the storage root. */
function resolveKey(storageKey) {
  const root = path.resolve(env.BILL_STORAGE_DIR);
  const full = path.resolve(root, storageKey);
  // Keys are generated server-side and cannot contain "..", but this catches a
  // corrupted or hand-edited database row before it reads outside the root.
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw ApiError.business(400, 'INVALID_STORAGE_KEY', 'Invalid file reference');
  }
  return full;
}

export async function put(storageKey, buffer) {
  const destination = resolveKey(storageKey);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, buffer);
}

export async function get(storageKey) {
  try {
    return await readFile(resolveKey(storageKey));
  } catch (error) {
    if (error.code === 'ENOENT') {
      const missing = new Error('Stored bill file not found');
      missing.notFound = true;
      throw missing;
    }
    throw error;
  }
}

export async function remove(storageKey) {
  try {
    await unlink(resolveKey(storageKey));
  } catch (error) {
    // Already gone is success for this purpose (idempotent delete).
    if (error.code !== 'ENOENT') throw error;
  }
}
