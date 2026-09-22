import { ApiError } from '../../utils/api-error.js';
import * as platformRepository from './platform.repository.js';
import { toBusinessDate, toDateString, deriveStatus } from './subscription.rules.js';

// THE SUBSCRIPTION GUARD.
//
// Called from the same single point the accounting period guard is called from -
// `createPostedEntryWithinTransaction` - for exactly the same reason. Every
// posted document in this system passes through that function, so refusing here
// refuses sales, purchases, expenses, receipts, supplier payments, both return
// types, reversals and opening balances at once, and any document type added
// later inherits it without anyone remembering to wire it up.
//
// THE RULE, in three lines:
//
//   shop has a CURRENT subscription   -> allow
//   shop has an EXPIRED or CANCELLED  -> refuse
//   shop has NO subscription at all   -> ALLOW
//
// WHY THE THIRD LINE IS NOT "REFUSE".
//
//   This is the same trap the period guard sidestepped, and the reasoning is
//   worth repeating. Every business that existed before this phase has no
//   subscription row. Refusing postings for them would stop every one of them
//   trading the instant this deployed - not because anybody decided to cut them
//   off, but because a table was added.
//
//   A shop that never went through the SaaS funnel is not an expired shop. It is
//   a shop the funnel never touched, and it keeps working exactly as it did.
//   Only a subscription that EXISTS and has run out closes the door, because
//   only then has somebody actually been sold something that ended.
//
// WHAT THIS GUARD DOES NOT DO.
//
//   It does not block reading. An expired shop can still open its books, run its
//   reports and export its data - all of it is theirs. What it cannot do is
//   record new business. Locking a shop out of its own history to extract a
//   renewal would be a hostage-taking, not a product.

/**
 * Refuses a posting from a shop whose subscription has run out.
 *
 * Called INSIDE the caller's transaction, alongside the period guard, so the
 * read and the write are one atomic unit.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} companyId
 * @param {string} [description] what is being posted, for the error message
 */
export async function assertSubscriptionAllowsPosting(
  tx,
  companyId,
  description = 'This document',
) {
  // NO COMPANY, NOTHING TO CHECK.
  //
  // Platform staff have companyId = null. They never post to a shop's books -
  // there is no tenant for them to post into - so this guard has nothing to say
  // about them, and must never be the reason a platform operation fails.
  //
  // Without this line the behaviour would be the same by accident (a null
  // companyId matches no subscription, so the function falls through to
  // "allowed"). Accidental correctness in a security guard is worth replacing
  // with the deliberate kind.
  if (!companyId) return null;

  // Judged against TODAY, not against the document's business date. A shop
  // whose plan lapsed last week must not be able to carry on recording by
  // backdating; a shop that renewed today may record a bill from last month.
  const today = toBusinessDate(new Date().toISOString().slice(0, 10));

  const entitling = await platformRepository.findEntitlingSubscription(companyId, today, tx);
  if (entitling) return entitling;

  const latest = await platformRepository.findLatestSubscription(companyId, tx);

  // Never sold anything. Not our business to stop them - see the note above.
  if (!latest) return null;

  const status = deriveStatus(latest, today);

  if (status === 'CANCELLED') {
    throw ApiError.business(
      402,
      'SUBSCRIPTION_CANCELLED',
      `${description} cannot be recorded: this business's subscription was cancelled.` +
        ' Your existing records stay available to read and export.',
    );
  }

  throw ApiError.business(
    402,
    'SUBSCRIPTION_EXPIRED',
    `${description} cannot be recorded: the "${latest.planNameSnapshot}" subscription ended on` +
      ` ${toDateString(latest.endDate)}. Renew it to carry on recording business.` +
      ' Your existing records stay available to read and export.',
  );
}

/**
 * The same question, asked outside a transaction, for a screen rather than a
 * posting.
 *
 * The shop application calls this to decide whether to show its renewal notice.
 * It is advisory: nothing depends on the browser being honest about the answer,
 * because the guard above is what actually refuses the write.
 */
export async function checkEntitlement(companyId) {
  const today = toBusinessDate(new Date().toISOString().slice(0, 10));
  const entitling = await platformRepository.findEntitlingSubscription(companyId, today);

  if (entitling) return { canPost: true, status: 'ACTIVE' };

  const latest = await platformRepository.findLatestSubscription(companyId);
  if (!latest) return { canPost: true, status: 'NONE' };

  return { canPost: false, status: deriveStatus(latest, today) };
}
