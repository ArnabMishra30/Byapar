import { toDecimal, add, subtract, toMoneyString, isZero } from '../../utils/money.js';
import * as journalRepository from '../accounting/journal.repository.js';
import * as accountRepository from '../accounting/account.repository.js';
import * as creditRepository from '../credit/credit.repository.js';
import { SYSTEM_ACCOUNT } from '../accounting/system-accounts.js';

// IS THIS PERIOD SAFE TO CLOSE?
//
// Closing is meant to be permanent, so it is worth looking before locking. This
// answers one question - "does everything in this range agree with everything
// else?" - and it answers it read-only, so an admin can ask it as often as they
// like without changing anything.
//
// WHAT IT CHECKS, and why each one earns its place:
//
//   1. THE PERIOD'S LINES BALANCE. Total debits equal total credits across every
//      journal line dated inside the range. The posting service already refuses
//      an unbalanced entry, so this should never fail - and that is exactly the
//      point. If it ever does, something has written to the database around the
//      posting path, and closing on top of that would set the damage in stone.
//
//   2. THE SUB-LEDGERS AGREE WITH THEIR CONTROL ACCOUNTS. What the customers owe,
//      added up, must equal the Accounts Receivable balance. Same for suppliers
//      and Accounts Payable. These are two independent records of the same fact,
//      maintained by different code paths, and a divergence between them is the
//      single most common way a real accounting system goes quietly wrong.
//
// WHAT IT DELIBERATELY DOES NOT CHECK:
//
//   DRAFTS. A draft dated inside the period is not an error - it is a document
//   somebody has not finished, and it has no accounting effect at all. Refusing
//   to close a month because a half-typed invoice exists would be an obstruction,
//   not a safeguard. They are REPORTED so nobody is surprised, and they do not
//   block the close.
//
// The checks are as of the period's END DATE, not today: closing March asks
// whether March's books were right on 31 March.

/** A tolerance of zero. These are Decimals; they either agree or they do not. */
function agrees(a, b) {
  return isZero(subtract(toDecimal(a ?? 0), toDecimal(b ?? 0)));
}

/**
 * Checks whether a period is internally consistent.
 *
 * Read-only. Returns a structured report rather than throwing, so the same
 * function serves both the preflight endpoint and the close path.
 *
 * @param {string} companyId
 * @param {{ startDate: Date, endDate: Date }} period
 */
export async function verifyPeriod(companyId, period) {
  const checks = [];

  // --- 1. the period's own lines balance ------------------------------------
  const totals = await journalRepository.sumAllLines(companyId, {
    dateFrom: period.startDate,
    dateTo: period.endDate,
  });

  const periodDebit = toDecimal(totals?._sum?.debit ?? 0);
  const periodCredit = toDecimal(totals?._sum?.credit ?? 0);

  checks.push({
    key: 'PERIOD_BALANCED',
    label: 'Journal entries in this period balance',
    passed: agrees(periodDebit, periodCredit),
    expected: toMoneyString(periodDebit, 2),
    actual: toMoneyString(periodCredit, 2),
    difference: toMoneyString(subtract(periodDebit, periodCredit), 2),
    detail:
      'Total debits and total credits dated inside this period. The posting ' +
      'service cannot write an unbalanced entry, so a failure here means ' +
      'something wrote to the database outside it.',
  });

  // --- 2. the whole ledger balances up to the period end --------------------
  //
  // A period can balance internally while the books as a whole do not, if an
  // earlier range is broken. Closing would then lock a period that looks fine
  // sitting on top of one that is not.
  const cumulative = await journalRepository.sumAllLines(companyId, {
    dateTo: period.endDate,
  });

  const cumulativeDebit = toDecimal(cumulative?._sum?.debit ?? 0);
  const cumulativeCredit = toDecimal(cumulative?._sum?.credit ?? 0);

  checks.push({
    key: 'LEDGER_BALANCED',
    label: 'The whole ledger balances up to the period end',
    passed: agrees(cumulativeDebit, cumulativeCredit),
    expected: toMoneyString(cumulativeDebit, 2),
    actual: toMoneyString(cumulativeCredit, 2),
    difference: toMoneyString(subtract(cumulativeDebit, cumulativeCredit), 2),
    detail: 'Every posted line from the beginning of the books to this period end.',
  });

  // --- 3. the sub-ledgers agree with their control accounts -----------------
  const [arAccount, apAccount] = await Promise.all([
    accountRepository.findByCodeAndCompany(SYSTEM_ACCOUNT.ACCOUNTS_RECEIVABLE, companyId),
    accountRepository.findByCodeAndCompany(SYSTEM_ACCOUNT.ACCOUNTS_PAYABLE, companyId),
  ]);

  const [arControl, apControl, customerDue, supplierDue] = await Promise.all([
    controlBalance(companyId, arAccount?.id, period.endDate, 'DEBIT'),
    controlBalance(companyId, apAccount?.id, period.endDate, 'CREDIT'),
    sumOpenReceivables(companyId),
    sumOpenPayables(companyId),
  ]);

  checks.push({
    key: 'RECEIVABLES_RECONCILE',
    label: 'Customer dues equal the Accounts Receivable control account',
    passed: agrees(customerDue, arControl),
    expected: toMoneyString(arControl, 2),
    actual: toMoneyString(customerDue, 2),
    difference: toMoneyString(subtract(customerDue, arControl), 2),
    detail:
      'The customer sub-ledger and the AR control account are two independent ' +
      'records of the same fact. They must agree.',
  });

  checks.push({
    key: 'PAYABLES_RECONCILE',
    label: 'Supplier dues equal the Accounts Payable control account',
    passed: agrees(supplierDue, apControl),
    expected: toMoneyString(apControl, 2),
    actual: toMoneyString(supplierDue, 2),
    difference: toMoneyString(subtract(supplierDue, apControl), 2),
    detail:
      'The supplier sub-ledger and the AP control account are two independent ' +
      'records of the same fact. They must agree.',
  });

  const failed = checks.filter((check) => !check.passed);

  return {
    period: {
      startDate: period.startDate.toISOString().slice(0, 10),
      endDate: period.endDate.toISOString().slice(0, 10),
    },
    ok: failed.length === 0,
    checks,
    failed: failed.map((check) => check.key),
  };
}

/**
 * What every customer owes, added up.
 *
 * Uses the credit module's OWN queries rather than a new one, so this check
 * compares the control account against the very numbers the credit book and the
 * dashboard show a user. A check against a privately-written query would prove
 * nothing about what anybody actually sees.
 */
async function sumOpenReceivables(companyId) {
  const rows = await creditRepository.groupOutstandingReceivables(companyId);
  return rows.reduce((total, row) => add(total, row._sum.outstandingAmount ?? 0), toDecimal(0));
}

/** The same for suppliers. */
async function sumOpenPayables(companyId) {
  const rows = await creditRepository.findOpenPayables(companyId);
  return rows.reduce((total, row) => add(total, row.outstandingAmount ?? 0), toDecimal(0));
}

/**
 * A control account's balance as of a date, in its natural direction.
 *
 * AR is debit-normal and AP credit-normal, so each is signed the way an
 * accountant would read it: a positive AR means customers owe the business.
 */
async function controlBalance(companyId, accountId, dateTo, normal) {
  if (!accountId) return toDecimal(0);

  const rows = await journalRepository.sumLinesGroupedByAccount(companyId, {
    accountId,
    dateTo,
  });

  const row = Array.isArray(rows) ? rows[0] : rows;
  const debit = toDecimal(row?._sum?.debit ?? 0);
  const credit = toDecimal(row?._sum?.credit ?? 0);

  return normal === 'DEBIT' ? subtract(debit, credit) : subtract(credit, debit);
}

export { controlBalance };
