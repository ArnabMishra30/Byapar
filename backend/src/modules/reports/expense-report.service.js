import { toDecimal, toMoneyString } from '../../utils/money.js';
import * as expenseRepository from '../expenses/expense.repository.js';
import { toDateString, toPublicPeriod } from './period.js';

// The expense report.
//
// ONLY POSTED EXPENSES ARE MONEY.
//   Every financial total here counts POSTED expenses and nothing else. Drafts
//   have paid nobody; cancelled ones never happened; a reversed one was undone by
//   an opposite journal entry and nets to zero in the ledger, so counting it
//   would overstate what the business spent.
//
//   Those three are not hidden, though: `otherStatuses` reports each of them with
//   its own count and amount, so a draft sitting unposted is visible rather than
//   silently missing.
//
// THE SAME ROWS, GROUPED FOUR WAYS. Category, payment mode, payment account and
// date are all groupings of one filtered set, so each adds back up to the same
// total - and to the Operating Expenses figure in the profit and loss, because
// both are the same posted journal entries.

const MONEY_DP = 2;
const money = (value) => toMoneyString(value ?? 0, MONEY_DP);

/** The statuses that never reach a financial total, and why. */
const NON_FINANCIAL_STATUSES = {
  DRAFT: 'Prepared but not posted. Has paid nobody and affects no account.',
  CANCELLED: 'A draft that was abandoned. Never had an accounting effect.',
  REVERSED: 'Posted and then undone by an opposite journal entry. Nets to zero.',
};

/**
 * @param {{ companyId: string }} currentUser
 * @param {object} query date range and the usual filters
 */
export async function getExpenseReport(currentUser, query = {}) {
  const { companyId } = currentUser;

  // The financial view is POSTED only. A caller may ask for another status
  // explicitly, in which case they get exactly what they asked for and the
  // response says so.
  const requestedStatus = query.status ?? null;
  const filters = { ...query, status: requestedStatus ?? 'POSTED' };

  const [totals, byCategory, byPaymentMode, byPaymentAccount, byDate, statusRows] =
    await Promise.all([
      expenseRepository.sumByCompany(companyId, filters),
      expenseRepository.groupByCategory(companyId, filters),
      expenseRepository.groupByPaymentMode(companyId, filters),
      expenseRepository.groupByPaymentAccount(companyId, filters),
      expenseRepository.groupByDate(companyId, filters),
      expenseRepository.countByStatus(companyId, query),
    ]);

  const total = toDecimal(totals.amount ?? 0);

  const categories = byCategory
    .map((row) => ({
      accountId: row.expenseAccountId,
      category: row.categoryNameSnapshot,
      expenseCount: row._count._all,
      amount: money(row._sum.amount),
      rawAmount: toDecimal(row._sum.amount ?? 0),
    }))
    .sort((a, b) => b.rawAmount.comparedTo(a.rawAmount));

  const statusByName = Object.fromEntries(
    statusRows.map((row) => [
      row.status,
      { count: row._count._all, amount: money(row._sum.amount) },
    ]),
  );

  return {
    period: toPublicPeriod({
      label: 'Selected period',
      fromDate: query.fromDate ?? null,
      toDate: query.toDate ?? null,
    }),
    basis: {
      countedStatus: filters.status,
      description:
        requestedStatus === null
          ? 'Financial totals count POSTED expenses only. Drafts, cancelled and reversed expenses are listed separately and never reach a total.'
          : `Filtered to ${requestedStatus} expenses at the caller's request.`,
    },

    totals: {
      totalExpenses: money(total),
      expenseCount: totals.documentCount,
      // What each share of the total is, so the biggest cost is obvious.
      largestCategory: categories[0]
        ? { category: categories[0].category, amount: categories[0].amount }
        : null,
    },

    byCategory: categories.map(({ rawAmount, ...row }) => row),

    byPaymentMode: byPaymentMode
      .map((row) => ({
        paymentMode: row.paymentMode,
        expenseCount: row._count._all,
        amount: money(row._sum.amount),
      }))
      .sort((a, b) => a.paymentMode.localeCompare(b.paymentMode)),

    byPaymentAccount: byPaymentAccount
      .map((row) => ({
        accountId: row.paymentAccountId,
        account: row.paymentAccountNameSnapshot,
        expenseCount: row._count._all,
        amount: money(row._sum.amount),
      }))
      .sort((a, b) => a.account.localeCompare(b.account)),

    byDate: byDate
      .map((row) => ({
        date: toDateString(row.expenseDate),
        expenseCount: row._count._all,
        amount: money(row._sum.amount),
      }))
      .sort((a, b) => a.date.localeCompare(b.date)),

    // Visible, but never in a total.
    otherStatuses: Object.entries(NON_FINANCIAL_STATUSES).map(([status, reason]) => ({
      status,
      reason,
      count: statusByName[status]?.count ?? 0,
      amount: statusByName[status]?.amount ?? '0.00',
      includedInTotals: false,
    })),

    note: 'Every posted expense here is one balanced journal entry: the category account debited, Cash or Bank credited. This total is the Operating Expenses figure in the profit and loss.',
  };
}

/** Just the number, for the dashboard. Posted expenses in a period. */
export async function sumPostedExpenses(companyId, period) {
  const totals = await expenseRepository.sumByCompany(companyId, {
    status: 'POSTED',
    fromDate: period.fromDate,
    toDate: period.toDate,
  });

  return {
    amount: toDecimal(totals.amount ?? 0),
    expenseCount: totals.documentCount,
  };
}
