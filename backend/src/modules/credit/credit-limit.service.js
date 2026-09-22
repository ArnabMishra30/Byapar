import { ApiError } from '../../utils/api-error.js';
import { add, subtract, round, toDecimal, toMoneyString, isGreaterThan, isZero } from '../../utils/money.js';
import * as creditRepository from './credit.repository.js';

// CREDIT LIMITS.
//
// Until this phase `creditLimit` was stored on a customer, shown in the credit
// book, and checked by nothing. This is where it becomes a rule.
//
// THE POLICY, stated once so nothing has to guess it:
//
//   ZERO MEANS UNLIMITED.
//     Every customer in every existing company already carries the schema
//     default of 0. Reading 0 as "no credit allowed" would refuse every sale
//     that has ever been made. So 0 - and only 0 - means no limit is set, and
//     the check passes without looking further. A business that wants a limit
//     sets a positive one.
//
//   EXPOSURE IS THE LEDGER BALANCE, NOT THE INVOICE TOTALS.
//     What a customer owes is sum(debit) - sum(credit) on the customer ledger:
//     invoices raise it, receipts and credit notes lower it. Using the ledger
//     rather than open-invoice totals means an advance the customer has paid
//     genuinely reduces their exposure, which is the honest answer.
//
//   ONLY POSTED DOCUMENTS COUNT.
//     A draft invoice owes nothing, a cancelled one never happened, and neither
//     is in the ledger. That falls out of the sub-ledger being written only in a
//     posting transaction - no status filtering is needed here, and none is done.
//
//   THE CHECK RUNS AT POST, UNDER A LOCK ON THE CUSTOMER ROW.
//     Posting is the moment the receivable is raised. The lock is what stops two
//     invoices for the same customer from both passing a limit they only breach
//     together.
//
//   AN ADMIN MAY OVERRIDE, AND IS RECORDED DOING SO.
//     Refusing outright would be wrong: a shopkeeper who decides to extend
//     credit to a regular customer is making a business decision, not a mistake.
//     The override is stored on the invoice with who made it, why, and what was
//     owed at that moment.
//
// Suppliers have a creditLimit too. It is reported and never enforced, and that
// asymmetry is deliberate: refusing to record a bill a supplier has already sent
// would not stop the liability, it would only hide it.

const MONEY_DP = 4;
const DISPLAY_DP = 2;

const money = (value) => toMoneyString(value ?? 0, DISPLAY_DP);

/** A limit of zero is not a limit of zero rupees. It is no limit at all. */
export function isUnlimited(creditLimit) {
  return isZero(toDecimal(creditLimit ?? 0));
}

/**
 * A customer's credit position, as pure arithmetic.
 *
 * Exported and dependency-free so every rule below can be unit tested without a
 * database - the same treatment `deriveReceivableState` gets in the sub-ledger.
 *
 * @param {object} input
 * @param {string|Decimal} input.creditLimit     0 means unlimited
 * @param {string|Decimal} input.outstanding     ledger balance; may be negative
 *   when the customer is in advance
 * @param {string|Decimal} [input.newExposure]   an invoice about to be posted
 * @returns {object} the position, with every figure as a 2dp string
 */
export function deriveCreditPosition({ creditLimit, outstanding, newExposure = 0 }) {
  const limit = toDecimal(creditLimit ?? 0);
  const owed = toDecimal(outstanding ?? 0);
  const additional = toDecimal(newExposure ?? 0);
  const unlimited = isUnlimited(limit);

  // A customer in advance owes less than nothing; they have not used any credit.
  const used = isGreaterThan(0, owed) ? toDecimal(0) : owed;
  const projected = add(owed, additional);

  // Available credit is never negative and never exceeds the limit itself.
  const rawAvailable = subtract(limit, used);
  const available = unlimited
    ? null
    : round(isGreaterThan(0, rawAvailable) ? toDecimal(0) : rawAvailable, MONEY_DP);

  const exceededBy = unlimited ? toDecimal(0) : subtract(projected, limit);
  const wouldExceed = !unlimited && isGreaterThan(projected, limit);

  return {
    creditLimit: money(limit),
    // The one field a client needs to decide whether to show a limit at all.
    isUnlimited: unlimited,
    outstanding: money(owed),
    /** What is left to spend. Null when there is no limit - not "infinity". */
    availableCredit: available === null ? null : money(available),
    /**
     * How much of the limit is used, 0-100 and clamped there. Null when
     * unlimited, because a percentage of no limit is not a number.
     */
    utilisationPercent: unlimited ? null : utilisationOf(used, limit),
    projectedOutstanding: money(projected),
    wouldExceed,
    exceededBy: wouldExceed ? money(exceededBy) : '0.00',
  };
}

/**
 * Used against limit, as a percentage with two decimals.
 *
 * Decimal throughout: a utilisation figure drives a business decision, so it is
 * held to the same standard as the money it is derived from.
 */
function utilisationOf(used, limit) {
  if (isZero(limit)) return null;
  const percent = used.div(limit).times(100);
  // Over-limit reads as 100%: the bar is full, and `exceededBy` carries the rest.
  const clamped = isGreaterThan(percent, 100) ? toDecimal(100) : percent;
  return toMoneyString(isGreaterThan(0, clamped) ? toDecimal(0) : clamped, DISPLAY_DP);
}

/**
 * The credit position of one customer, read from the canonical ledger.
 *
 * @param {string} companyId
 * @param {object} customer   must carry id, creditLimit, creditDays
 * @param {object} [options]
 * @param {string|Decimal} [options.newExposure]  an invoice about to be posted
 * @param {import('@prisma/client').Prisma.TransactionClient} [options.client]
 */
export async function getCreditPosition(companyId, customer, { newExposure = 0, client } = {}) {
  const outstanding = await creditRepository.customerLedgerBalance(
    companyId,
    customer.id,
    client,
  );

  return {
    ...deriveCreditPosition({
      creditLimit: customer.creditLimit,
      outstanding,
      newExposure,
    }),
    creditDays: customer.creditDays ?? null,
  };
}

/**
 * Enforces the limit while a sales invoice is being posted.
 *
 * Called from inside the sales posting transaction, AFTER the customer row has
 * been locked, so the balance it reads cannot change under it and two concurrent
 * invoices for the same customer are serialised.
 *
 * Returns the position so the caller can record it on an override without
 * reading the balance twice.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {object} params
 * @param {object} params.customer     the LOCKED customer row
 * @param {string|Decimal} params.invoiceTotal
 * @param {boolean} [params.override]  an ADMIN's explicit decision to proceed
 */
export async function assertWithinCreditLimit(
  tx,
  { companyId, customer, invoiceTotal, invoiceNumber, override = false },
) {
  const position = await getCreditPosition(companyId, customer, {
    newExposure: invoiceTotal,
    client: tx,
  });

  if (!position.wouldExceed) return { position, overridden: false };

  if (!override) {
    throw ApiError.business(
      422,
      'CREDIT_LIMIT_EXCEEDED',
      `${customer.name} would owe ${position.projectedOutstanding} against a credit limit of ${position.creditLimit}` +
        ` - ${position.exceededBy} over. Posting ${invoiceNumber} needs an admin override.`,
    );
  }

  return { position, overridden: true };
}

/** The 2dp public shape of a party's credit terms, used by several reads. */
export function toPublicCreditTerms(party) {
  return {
    creditLimit: money(party.creditLimit),
    isUnlimited: isUnlimited(party.creditLimit),
    creditDays: party.creditDays ?? null,
  };
}

export { money };
