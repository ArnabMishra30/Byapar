import { ApiError } from '../../utils/api-error.js';
import * as periodRepository from './period.repository.js';
import * as companySettingsRepository from '../company-settings/company-settings.repository.js';
import { todayIn, toBusinessDate } from '../reports/period.js';

// THE POSTING GUARD.
//
// One function, called from the single point every posted journal entry goes
// through. That is the whole design: `createPostedEntryWithinTransaction` in
// journal.service.js is called by exactly one file (gl-posting.service.js, once
// per document type) and by the journal reversal path. Guarding there protects
// sales, purchases, expenses, receipts, supplier payments, both return types,
// reversals and opening balances at once - and a route added tomorrow inherits
// it without anyone remembering to.
//
// Putting this in a controller, or in each of the eight document services, would
// mean eight places to forget.
//
// THE RULE, in three lines:
//
//   date falls in a CLOSED period   -> refuse
//   date falls in an OPEN period    -> allow
//   date falls in NO period         -> allow, unless the company opted in to
//                                      the stricter rule
//
// WHY THE THIRD LINE IS NOT "REFUSE".
//   No company created before this phase has a single period. Refusing postings
//   with no period would stop every existing business from trading the moment
//   this deployed, and would turn "create a period" into a hidden prerequisite
//   for using the application at all. So periods are OPT-IN: a company that
//   never creates one behaves exactly as it always did.
//
//   A business that wants the strict rule - every posting inside a declared
//   period, no exceptions - sets `requireOpenPeriod` on its company settings.
//   That is a deliberate choice, made once, and it is then enforced here.

/** A business date back to "YYYY-MM-DD", for error messages. */
function toDateString(date) {
  return date ? new Date(date).toISOString().slice(0, 10) : null;
}

/**
 * Refuses a posting whose business date falls in a closed period.
 *
 * Called INSIDE the caller's transaction, so the read of the period and the
 * write of the document are one atomic unit: a period cannot be closed between
 * the check and the insert. The close path takes a row lock on the period, which
 * is the other half of that guarantee.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} companyId
 * @param {Date} entryDate      the BUSINESS date of the document, never `now`
 * @param {string} [description] what is being posted, for the error message
 */
export async function assertPostingAllowed(tx, companyId, entryDate, description = 'This document') {
  if (!entryDate) return null;

  const period = await periodRepository.findByDate(companyId, entryDate, tx);

  if (period && period.status === 'CLOSED') {
    throw ApiError.business(
      422,
      'ACCOUNTING_PERIOD_CLOSED',
      `${description} is dated ${toDateString(entryDate)}, which falls in "${period.name}"` +
        ` (${toDateString(period.startDate)} to ${toDateString(period.endDate)}). That period is closed.`,
    );
  }

  if (period) return period;

  // No period covers this date. Allowed unless the company asked for the
  // stricter rule - and the flag is only read when there is no period, so the
  // common path costs one indexed lookup and nothing more.
  if (await periodRepository.requiresOpenPeriod(companyId, tx)) {
    throw ApiError.business(
      422,
      'NO_OPEN_ACCOUNTING_PERIOD',
      `${description} is dated ${toDateString(entryDate)}, which falls in no accounting period.` +
        ' This company requires every posting to fall inside an open period.',
    );
  }

  return null;
}

/**
 * The same rule for an operation that changes stock but writes no journal entry.
 *
 * Inventory adjustments and standalone opening stock move quantities without a
 * GL entry in this system, so they never reach the journal guard. They are dated
 * by when they happen, so the date to check is the company's today.
 */
export async function assertStockChangeAllowed(tx, companyId, date, description = 'This movement') {
  return assertPostingAllowed(tx, companyId, date, description);
}

export { toDateString };

/**
 * Today, in the company's OWN timezone, as the UTC-midnight date the business
 * columns store.
 *
 * A stock adjustment carries no business date - it happens when it happens - so
 * the period it falls in has to be resolved from the clock. Between 00:00 and
 * 05:30 IST a UTC "today" is yesterday in Mumbai, which would put a morning's
 * adjustment in the wrong period. This reuses the dashboard's existing timezone
 * resolution rather than introducing a second strategy.
 */
export async function companyToday(companyId) {
  const settings = await companySettingsRepository.findByCompany(companyId);
  return toBusinessDate(todayIn(settings?.timezone ?? 'UTC'));
}
