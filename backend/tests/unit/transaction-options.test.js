import { describe, it, expect, vi, beforeEach } from 'vitest';

// HOW LONG A TRANSACTION IS GIVEN.
//
// Prisma's defaults (2s to get a connection, 5s to finish) assume a database on
// the same machine. Posting a document is dozens of round trips, and against a
// managed database in another region - or one waking from idle - five seconds
// runs out part way through. The transaction aborts, so nothing is half-written,
// but the shop just sees a 500 it cannot act on.
//
// These tests pin the options down, because losing them again would only show up
// in production, under latency, on somebody's real purchase.

const transactionSpy = vi.fn(async (fn) => fn({}));

vi.mock('../../src/config/prisma.js', () => ({
  prisma: {
    $transaction: (...args) => transactionSpy(...args),
  },
}));

const { withTransaction, withRetryableTransaction } = await import(
  '../../src/config/transaction.js'
);
const { env } = await import('../../src/config/env.js');

beforeEach(() => {
  transactionSpy.mockClear();
});

describe('transaction options', () => {
  it('gives a plain transaction a configured budget, not Prisma defaults', async () => {
    await withTransaction(async () => 'done');

    const [, options] = transactionSpy.mock.calls[0];
    expect(options).toEqual({
      maxWait: env.DB_TRANSACTION_MAX_WAIT_MS,
      timeout: env.DB_TRANSACTION_TIMEOUT_MS,
    });
  });

  it('gives a retryable transaction the same budget', async () => {
    await withRetryableTransaction(async () => 'done');

    const [, options] = transactionSpy.mock.calls[0];
    expect(options.timeout).toBe(env.DB_TRANSACTION_TIMEOUT_MS);
    expect(options.maxWait).toBe(env.DB_TRANSACTION_MAX_WAIT_MS);
  });

  it('allows enough time for a posting against a database in another region', () => {
    // Not arbitrary: a posting is dozens of round trips, and 5s is not enough
    // once each one costs tens of milliseconds.
    expect(env.DB_TRANSACTION_TIMEOUT_MS).toBeGreaterThanOrEqual(15000);
    expect(env.DB_TRANSACTION_MAX_WAIT_MS).toBeGreaterThanOrEqual(5000);
  });
});
