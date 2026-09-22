import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/api-error.js';

// WHERE UPLOADED BILLS LIVE.
//
// Three rules, and every one of them exists because the alternative is a real
// hole:
//
//   1. THE CLIENT NEVER NAMES A FILE. The name it sends is kept for display and
//      nothing else. The name on disk is a uuid this server generated. A file
//      called "../../../etc/passwd" is therefore just an odd-looking label in a
//      database column - it cannot steer a single byte of the write.
//
//   2. THE PATH IS DERIVED FROM THE AUTHENTICATED COMPANY. companyId comes from
//      req.user, so one shop's bills cannot be written into, or read out of,
//      another shop's folder. Every read re-derives the path from the caller's
//      own company and compares it to the stored key.
//
//   3. THE BROWSER NEVER SEES A PATH. It gets a bill id. The mapping from id to
//      location happens here, on the server, so no filesystem layout ever
//      escapes into a URL where somebody can start editing it.

/** What a bill may be. Anything else is refused before a byte is written. */
export const ACCEPTED_MIME_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'application/pdf': '.pdf',
};

/**
 * The magic bytes each accepted type must start with.
 *
 * A browser's Content-Type is a claim, not evidence - anyone can post whatever
 * they like with `image/png` on it. This checks the file itself.
 */
const MAGIC_BYTES = {
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  'application/pdf': [[0x25, 0x50, 0x44, 0x46]], // "%PDF"
  // RIFF....WEBP - the second group sits at offset 8, checked separately.
  'image/webp': [[0x52, 0x49, 0x46, 0x46]],
  // ....ftyp at offset 4.
  'image/heic': null,
};

function startsWith(buffer, bytes, offset = 0) {
  if (buffer.length < offset + bytes.length) return false;
  return bytes.every((byte, index) => buffer[offset + index] === byte);
}

/**
 * Confirms a file really is what it says it is.
 *
 * @returns {boolean}
 */
export function looksLikeDeclaredType(buffer, mimeType) {
  if (mimeType === 'image/webp') {
    return startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) && startsWith(buffer, [0x57, 0x45, 0x42, 0x50], 8);
  }
  if (mimeType === 'image/heic') {
    // ISO base media: a 4-byte box length, then "ftyp".
    return startsWith(buffer, [0x66, 0x74, 0x79, 0x70], 4);
  }

  const signatures = MAGIC_BYTES[mimeType];
  if (!signatures) return false;
  return signatures.some((bytes) => startsWith(buffer, bytes));
}

/**
 * Reduces whatever the browser sent to something safe to show a human.
 *
 * This is for DISPLAY ONLY - it never becomes a path. Directory separators and
 * traversal sequences are stripped anyway, because a filename rendered into a
 * page or a download header is its own small hazard.
 */
export function sanitizeFilename(filename) {
  const base = String(filename ?? 'bill')
    .replace(/[\\/]/g, '_')
    .replace(/\.{2,}/g, '.')
    // Control characters, which have no business in a name that gets rendered
    // into a page or a Content-Disposition header.
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f]/g, '')
    .trim();

  // Whitelist. Anything outside it becomes an underscore rather than being
  // guessed at.
  const cleaned = base.replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 120);
  return cleaned.length > 0 ? cleaned : 'bill';
}

/**
 * The opaque key a stored bill is addressed by.
 *
 * Shaped "<companyId>/<yyyy-mm>/<uuid><ext>" - the company first so that a
 * shop's files are one subtree, and the month next so a folder never grows to a
 * million entries.
 */
function buildStorageKey(companyId, mimeType) {
  const extension = ACCEPTED_MIME_TYPES[mimeType] ?? '.bin';
  const month = new Date().toISOString().slice(0, 7);
  return `${companyId}/${month}/${randomUUID()}${extension}`;
}

/** Absolute location of a key, refusing anything that escapes the root. */
function resolveKey(storageKey) {
  const root = path.resolve(env.BILL_STORAGE_DIR);
  const full = path.resolve(root, storageKey);

  // Belt and braces. Keys are generated here and cannot contain "..", but this
  // is the check that would catch a corrupted or hand-edited database row before
  // it reads something it should not.
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw ApiError.business(400, 'INVALID_STORAGE_KEY', 'Invalid file reference');
  }

  return full;
}

/**
 * Writes an uploaded bill and returns the record fields describing it.
 *
 * @param {string} companyId  from req.user - never from the request body
 * @param {{ buffer: Buffer, originalname: string, mimetype: string, size: number }} file
 */
export async function storeBill(companyId, file) {
  if (!ACCEPTED_MIME_TYPES[file.mimetype]) {
    throw ApiError.business(
      422,
      'UNSUPPORTED_FILE_TYPE',
      'Upload a photo (JPG, PNG, WEBP or HEIC) or a PDF of the bill.',
    );
  }

  if (file.size > env.BILL_MAX_FILE_SIZE) {
    const mb = Math.round(env.BILL_MAX_FILE_SIZE / (1024 * 1024));
    throw ApiError.business(422, 'FILE_TOO_LARGE', `That file is too large. The limit is ${mb} MB.`);
  }

  if (!file.buffer || file.buffer.length === 0) {
    throw ApiError.business(422, 'EMPTY_FILE', 'That file is empty.');
  }

  if (!looksLikeDeclaredType(file.buffer, file.mimetype)) {
    throw ApiError.business(
      422,
      'FILE_TYPE_MISMATCH',
      `That file does not look like a ${file.mimetype.split('/')[1].toUpperCase()}. Upload the original photo or PDF of the bill.`,
    );
  }

  const storageKey = buildStorageKey(companyId, file.mimetype);
  const destination = resolveKey(storageKey);

  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, file.buffer);

  return {
    storageKey,
    originalFilename: sanitizeFilename(file.originalname),
    mimeType: file.mimetype,
    fileSize: file.buffer.length,
    /** Lets a duplicate upload be spotted without reading the file again. */
    checksum: createHash('sha256').update(file.buffer).digest('hex'),
  };
}

/**
 * Reads a stored bill back.
 *
 * The caller's company is required and checked against the key, so a bill id
 * belonging to another shop cannot be turned into a file read even if one leaked.
 */
export async function readBill(companyId, storageKey) {
  if (!storageKey.startsWith(`${companyId}/`)) {
    // 404, not 403: a caller must not learn that an id exists elsewhere.
    throw ApiError.notFound('Bill not found');
  }

  try {
    return await readFile(resolveKey(storageKey));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw ApiError.business(
        404,
        'BILL_FILE_MISSING',
        'The uploaded file is no longer available. Upload the bill again.',
      );
    }
    throw error;
  }
}

/** Removes a stored file. Used when an upload fails after the write. */
export async function deleteBill(storageKey) {
  try {
    await unlink(resolveKey(storageKey));
  } catch (error) {
    // Already gone is a success for this purpose.
    if (error.code !== 'ENOENT') throw error;
  }
}

export { buildStorageKey, resolveKey };
