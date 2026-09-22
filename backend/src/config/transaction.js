import { prisma } from './prisma.js';

/**
 * Runs several repository calls so they all succeed or all fail together.
 *
 *   await withTransaction((tx) => {
 *     const company = await companyRepository.create(data, tx);
 *     await userRepository.create(userData, tx);
 *   });
 *
 * Repository functions accept an optional client as their last argument - pass
 * `tx` so the call joins the transaction. This exists so services never have to
 * import the Prisma client directly.
 *
 * Do not use it for simple reads.
 */
export function withTransaction(fn) {
  return prisma.$transaction(fn);
}

// PostgreSQL error codes that mean "this transaction lost a race, try again".
const RETRYABLE_PG_CODES = ['40001', '40P01'];

function isRetryable(error) {
  // A concurrent insert of the same unique row (two requests creating the first
  // inventory balance for one product+warehouse at the same moment).
  if (error?.code === 'P2002') return true;
  // Prisma transaction conflict / serialization failure / deadlock.
  if (error?.code === 'P2034') return true;
  return RETRYABLE_PG_CODES.includes(error?.meta?.code) || RETRYABLE_PG_CODES.includes(error?.code);
}

/**
 * A transaction that retries when it loses a concurrency race.
 *
 * Inventory needs this: two requests can try to create the first balance row for
 * the same product and warehouse at the same instant. One wins, the other hits the
 * unique constraint - and the correct response is to run the whole calculation
 * again against the row that now exists, not to fail the user's request.
 *
 * Business errors (ApiError) are never retried: they are thrown straight out.
 */
export async function withRetryableTransaction(fn, { retries = 3 } = {}) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await prisma.$transaction(fn);
    } catch (error) {
      lastError = error;
      if (!isRetryable(error)) throw error;
    }
  }

  throw lastError;
}
