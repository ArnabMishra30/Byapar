import { ApiError } from '../../utils/api-error.js';
import { toSkipTake, buildPagination } from '../../utils/pagination.js';
import { withRetryableTransaction } from '../../config/transaction.js';
import * as periodRepository from './period.repository.js';
import { verifyPeriod } from './period-verification.service.js';
import { toDateString } from './period-guard.service.js';

// ACCOUNTING PERIODS.
//
// A period is a declared stretch of business dates a company can close. Closing
// it refuses NEW postings dated inside it; it never touches a posting already
// made. Historical journal entries are immutable in this system and stay that
// way - there is no closing entry, no rolled-forward balance, and nothing is
// rewritten to make the books "balance". They already balance.
//
// PERIODS ARE OPT-IN. A company with none behaves exactly as it did before this
// phase. See period-guard.service.js for the full rule and why.
//
// GST plays no part here. A shop with no registration closes its months exactly
// as a registered company does; nothing in this module reads a GSTIN.

// --- serialization ---------------------------------------------------------

export function toPublicPeriod(period) {
  return {
    id: period.id,
    name: period.name,
    startDate: toDateString(period.startDate),
    endDate: toDateString(period.endDate),
    status: period.status,
    /** The one field a client needs to decide whether posting is possible. */
    isClosed: period.status === 'CLOSED',
    createdBy: period.createdBy ? { id: period.createdBy.id, name: period.createdBy.name } : null,
    closedBy: period.closedBy ? { id: period.closedBy.id, name: period.closedBy.name } : null,
    closedAt: period.closedAt ?? null,
    reopenedBy: period.reopenedBy
      ? { id: period.reopenedBy.id, name: period.reopenedBy.name }
      : null,
    reopenedAt: period.reopenedAt ?? null,
    reopenReason: period.reopenReason ?? null,
    createdAt: period.createdAt,
    updatedAt: period.updatedAt,
  };
}

// --- writes ----------------------------------------------------------------

/**
 * Opens a new accounting period.
 *
 * Overlap is refused rather than merged: two periods covering one date would
 * make "is this date closed?" ambiguous, and an ambiguous lock is not a lock.
 */
export async function create(currentUser, input) {
  const { companyId } = currentUser;

  // The schema enforces startDate <= endDate too, at the database. Checked here
  // so the caller gets a business error rather than a constraint violation.
  if (input.startDate > input.endDate) {
    throw ApiError.business(
      422,
      'INVALID_PERIOD_RANGE',
      'A period cannot end before it starts',
    );
  }

  const existingName = await periodRepository.findByNameAndCompany(input.name, companyId);
  if (existingName) {
    throw ApiError.business(
      409,
      'ACCOUNTING_PERIOD_NAME_TAKEN',
      `A period named "${input.name}" already exists`,
    );
  }

  const overlapping = await periodRepository.findOverlapping(companyId, {
    startDate: input.startDate,
    endDate: input.endDate,
  });

  if (overlapping.length > 0) {
    const clash = overlapping[0];
    throw ApiError.business(
      422,
      'ACCOUNTING_PERIOD_OVERLAP',
      `That range overlaps "${clash.name}" (${toDateString(clash.startDate)} to ${toDateString(clash.endDate)}).` +
        ' Two periods cannot cover the same date.',
    );
  }

  const period = await withRetryableTransaction(async (tx) =>
    periodRepository.create(tx, {
      companyId,
      name: input.name,
      startDate: input.startDate,
      endDate: input.endDate,
      status: 'OPEN',
      createdById: currentUser.id,
    }),
  );

  return toPublicPeriod(period);
}

/**
 * Closes a period.
 *
 * The row is locked first, so two simultaneous closes serialise and the second
 * sees CLOSED. The status change is also conditional at the database - the
 * update matches only rows still OPEN - so even if the lock were bypassed a
 * second close would change nothing and report the conflict.
 *
 * A posting racing a close is resolved by the same lock from the other side: the
 * posting guard reads the period inside its own transaction, so it either sees
 * OPEN and commits before the close, or waits and sees CLOSED and is refused.
 * There is no window in which both succeed.
 */
export async function close(currentUser, id) {
  const { companyId } = currentUser;

  // LOOK BEFORE LOCKING.
  //
  // Closing is meant to be permanent, so the books are checked first: does the
  // period balance, does the whole ledger balance, and do the sub-ledgers agree
  // with their control accounts. A period that does not reconcile is a period
  // somebody needs to look at, not one to set in stone.
  //
  // Done OUTSIDE the transaction on purpose. The checks are read-only, and
  // holding a row lock across them would block postings for no benefit.
  const existing = await periodRepository.findByIdAndCompany(id, companyId);
  if (!existing) {
    throw ApiError.business(404, 'ACCOUNTING_PERIOD_NOT_FOUND', 'Accounting period not found');
  }

  if (existing.status === 'OPEN') {
    const verification = await verifyPeriod(companyId, existing);

    if (!verification.ok) {
      const failures = verification.checks.filter((check) => !check.passed);
      throw ApiError.business(
        409,
        'ACCOUNTING_PERIOD_NOT_RECONCILED',
        `"${existing.name}" does not reconcile and was not closed: ` +
          failures.map((check) => `${check.label} (out by ${check.difference})`).join('; ') +
          '. Nothing was changed.',
      );
    }
  }

  const period = await withRetryableTransaction(async (tx) => {
    const locked = await periodRepository.lockForUpdate(tx, id, companyId);

    // Another company's period is reported exactly like a non-existent one.
    if (!locked) {
      throw ApiError.business(404, 'ACCOUNTING_PERIOD_NOT_FOUND', 'Accounting period not found');
    }
    if (locked.status === 'CLOSED') {
      throw ApiError.business(
        409,
        'ACCOUNTING_PERIOD_ALREADY_CLOSED',
        `"${locked.name}" is already closed`,
      );
    }

    const updated = await periodRepository.updateStatus(tx, {
      id,
      companyId,
      fromStatus: 'OPEN',
      data: { status: 'CLOSED', closedById: currentUser.id, closedAt: new Date() },
    });

    if (!updated) {
      throw ApiError.business(
        409,
        'ACCOUNTING_PERIOD_ALREADY_CLOSED',
        'Only an open period can be closed',
      );
    }

    return updated;
  });

  return toPublicPeriod(period);
}

/**
 * Reopens a closed period.
 *
 * This exists because closing the wrong month is a mistake a person will make,
 * and the alternative would be a permanently unusable range. It is deliberately
 * attributed: who reopened it, when, and why.
 *
 * It rewrites nothing. Reopening only makes the range postable again; every
 * entry already in it is untouched, exactly as it was untouched by the close.
 */
export async function reopen(currentUser, id, input = {}) {
  const { companyId } = currentUser;

  const period = await withRetryableTransaction(async (tx) => {
    const locked = await periodRepository.lockForUpdate(tx, id, companyId);

    if (!locked) {
      throw ApiError.business(404, 'ACCOUNTING_PERIOD_NOT_FOUND', 'Accounting period not found');
    }
    if (locked.status === 'OPEN') {
      throw ApiError.business(
        409,
        'ACCOUNTING_PERIOD_NOT_CLOSED',
        `"${locked.name}" is already open`,
      );
    }

    const updated = await periodRepository.updateStatus(tx, {
      id,
      companyId,
      fromStatus: 'CLOSED',
      data: {
        status: 'OPEN',
        reopenedById: currentUser.id,
        reopenedAt: new Date(),
        reopenReason: input.reason ?? null,
        // The close is deliberately kept: the history of this period is that it
        // was closed by someone and reopened by someone.
      },
    });

    if (!updated) {
      throw ApiError.business(
        409,
        'ACCOUNTING_PERIOD_NOT_CLOSED',
        'Only a closed period can be reopened',
      );
    }

    return updated;
  });

  return toPublicPeriod(period);
}

/**
 * Checks whether a period would close, without closing it.
 *
 * Read-only and safe to call repeatedly. Lets an admin see what is wrong before
 * committing to something permanent.
 */
export async function verify(currentUser, id) {
  const { companyId } = currentUser;

  const period = await periodRepository.findByIdAndCompany(id, companyId);
  if (!period) {
    throw ApiError.business(404, 'ACCOUNTING_PERIOD_NOT_FOUND', 'Accounting period not found');
  }

  return { period: toPublicPeriod(period), verification: await verifyPeriod(companyId, period) };
}

// --- reads -----------------------------------------------------------------

export async function list(currentUser, query) {
  const { page, limit, status } = query;
  const { skip, take } = toSkipTake({ page, limit });

  const { items, total } = await periodRepository.findManyByCompany(currentUser.companyId, {
    skip,
    take,
    status,
  });

  return {
    periods: items.map(toPublicPeriod),
    pagination: buildPagination({ page, limit, total }),
  };
}

export async function getById(currentUser, id) {
  const period = await periodRepository.findByIdAndCompany(id, currentUser.companyId);
  if (!period) {
    throw ApiError.business(404, 'ACCOUNTING_PERIOD_NOT_FOUND', 'Accounting period not found');
  }
  return toPublicPeriod(period);
}

/**
 * "May I post on this date?" answered directly, so a client can grey out a date
 * picker instead of discovering the answer from a failed posting.
 */
export async function checkDate(currentUser, date) {
  const { companyId } = currentUser;

  const [period, strict] = await Promise.all([
    periodRepository.findByDate(companyId, date),
    periodRepository.requiresOpenPeriod(companyId),
  ]);

  if (period) {
    return {
      date: toDateString(date),
      period: {
        id: period.id,
        name: period.name,
        status: period.status,
        startDate: toDateString(period.startDate),
        endDate: toDateString(period.endDate),
      },
      canPost: period.status === 'OPEN',
      reason:
        period.status === 'OPEN'
          ? `Inside "${period.name}", which is open.`
          : `Inside "${period.name}", which is closed.`,
    };
  }

  return {
    date: toDateString(date),
    period: null,
    canPost: !strict,
    reason: strict
      ? 'This date falls in no accounting period, and this company requires every posting to fall inside one.'
      : 'This date falls in no accounting period. Postings are allowed: periods are opt-in, and only a closed period blocks.',
  };
}
