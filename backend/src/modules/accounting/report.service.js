import { add, subtract, toDecimal, toMoneyString } from '../../utils/money.js';
import * as accountRepository from './account.repository.js';
import * as journalRepository from './journal.repository.js';
import { deriveAccountBalance, normalBalanceSide } from './journal.service.js';
import { SYSTEM_ACCOUNT } from './system-accounts.js';

// Financial statements, computed from the journal every time they are asked for.
//
// THERE ARE NO STORED BALANCES ANYWHERE IN THIS FILE. Every figure is an
// aggregate over JournalLine, so a report can never disagree with the entries
// that produced it, and a report from last month recomputes identically today.
//
// Only POSTED entries are included - enforced in the repository, once.
//
// PRECISION: line amounts are already stored rounded to 4 dp, so summing them is
// exact. Rounding happens once more at the very edge, when a figure is
// serialized to a 2 dp string. Nothing in between rounds.

// --- shared aggregation ----------------------------------------------------

/**
 * Debit and credit totals per account for a period, joined to the chart of
 * accounts.
 *
 * Accounts with no activity in the window are dropped: a trial balance listing
 * every unused account is noise, and including them cannot change a total.
 */
async function accountTotals(companyId, { dateFrom, dateTo } = {}) {
  const [accounts, grouped] = await Promise.all([
    accountRepository.findAllByCompany(companyId),
    journalRepository.sumLinesGroupedByAccount(companyId, { dateFrom, dateTo }),
  ]);

  const byId = new Map(accounts.map((account) => [account.id, account]));

  return grouped
    .map((row) => {
      const account = byId.get(row.accountId);
      if (!account) return null;

      const debit = row._sum.debit ?? toDecimal(0);
      const credit = row._sum.credit ?? toDecimal(0);

      return {
        account,
        debit,
        credit,
        balance: deriveAccountBalance(account.type, debit, credit),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.account.code.localeCompare(b.account.code));
}

function sumBy(rows, key) {
  return rows.reduce((total, row) => add(total, row[key]), toDecimal(0));
}

function ofType(rows, type) {
  return rows.filter((row) => row.account.type === type);
}

function publicRow(row) {
  return {
    accountId: row.account.id,
    code: row.account.code,
    name: row.account.name,
    type: row.account.type,
    normalBalance: normalBalanceSide(row.account.type),
    debit: toMoneyString(row.debit, 2),
    credit: toMoneyString(row.credit, 2),
    balance: toMoneyString(row.balance, 2),
  };
}

// --- trial balance ---------------------------------------------------------

/**
 * Every account with activity up to `date`, with its debit total, credit total
 * and natural-direction balance.
 *
 * THE INVARIANT: total debits === total credits. It is reported explicitly as
 * `isBalanced` rather than assumed, because a trial balance whose only job is to
 * prove the books balance should say so out loud.
 */
export async function getTrialBalance(currentUser, { date } = {}) {
  const rows = await accountTotals(currentUser.companyId, { dateTo: date });

  const totalDebit = sumBy(rows, 'debit');
  const totalCredit = sumBy(rows, 'credit');

  return {
    asOfDate: date ? date.toISOString().slice(0, 10) : null,
    accounts: rows.map(publicRow),
    totalDebit: toMoneyString(totalDebit, 2),
    totalCredit: toMoneyString(totalCredit, 2),
    difference: toMoneyString(subtract(totalDebit, totalCredit), 2),
    isBalanced: subtract(totalDebit, totalCredit).isZero(),
  };
}

// --- profit and loss -------------------------------------------------------

/**
 * Revenue - Sales Returns - COGS - Other Expenses = Net Profit.
 *
 * "Sales Returns" is a CONTRA-REVENUE account: it is typed REVENUE but carries a
 * debit balance, so its natural balance is negative and it already reduces total
 * revenue. It is pulled out and shown as its own positive line because a P&L
 * that hides credit notes inside a net revenue figure is not much use.
 *
 * Cost of goods sold is likewise separated from other expenses so gross profit
 * is visible. Both are identified by their stable system codes, never by name.
 */
export async function getProfitAndLoss(currentUser, { dateFrom, dateTo } = {}) {
  const rows = await accountTotals(currentUser.companyId, { dateFrom, dateTo });

  const revenueRows = ofType(rows, 'REVENUE');
  const expenseRows = ofType(rows, 'EXPENSE');

  const contraRows = revenueRows.filter(
    (row) => row.account.code === SYSTEM_ACCOUNT.SALES_RETURNS,
  );
  const grossRevenueRows = revenueRows.filter(
    (row) => row.account.code !== SYSTEM_ACCOUNT.SALES_RETURNS,
  );
  const cogsRows = expenseRows.filter(
    (row) => row.account.code === SYSTEM_ACCOUNT.COST_OF_GOODS_SOLD,
  );
  const otherExpenseRows = expenseRows.filter(
    (row) => row.account.code !== SYSTEM_ACCOUNT.COST_OF_GOODS_SOLD,
  );

  const revenue = sumBy(grossRevenueRows, 'balance');
  // Negated: a contra-revenue balance is negative by convention, and a P&L reads
  // better with "Sales returns 566.40" than "-566.40".
  const salesReturns = sumBy(contraRows, 'balance').negated();
  const netRevenue = subtract(revenue, salesReturns);

  const costOfGoodsSold = sumBy(cogsRows, 'balance');
  const grossProfit = subtract(netRevenue, costOfGoodsSold);
  const otherExpenses = sumBy(otherExpenseRows, 'balance');
  const netProfit = subtract(grossProfit, otherExpenses);

  return {
    fromDate: dateFrom ? dateFrom.toISOString().slice(0, 10) : null,
    toDate: dateTo ? dateTo.toISOString().slice(0, 10) : null,
    revenue: {
      accounts: grossRevenueRows.map(publicRow),
      total: toMoneyString(revenue, 2),
    },
    salesReturns: {
      accounts: contraRows.map(publicRow),
      total: toMoneyString(salesReturns, 2),
    },
    netRevenue: toMoneyString(netRevenue, 2),
    costOfGoodsSold: {
      accounts: cogsRows.map(publicRow),
      total: toMoneyString(costOfGoodsSold, 2),
    },
    grossProfit: toMoneyString(grossProfit, 2),
    otherExpenses: {
      accounts: otherExpenseRows.map(publicRow),
      total: toMoneyString(otherExpenses, 2),
    },
    netProfit: toMoneyString(netProfit, 2),
  };
}

// --- balance sheet ---------------------------------------------------------

/**
 * Assets = Liabilities + Equity, as of a date.
 *
 * RETAINED EARNINGS ARE DERIVED, NOT POSTED. This system has no period-closing
 * process, so no journal entry ever moves profit into equity. Rather than
 * fabricate one, the balance sheet computes earnings since inception directly
 * from the revenue and expense accounts and reports it as its own equity line.
 *
 * That is what makes the identity hold, and it holds for a real reason:
 *   sum(debits) - sum(credits) = 0  over every posted line
 *   => Assets + Expenses - Liabilities - Equity - Revenue = 0
 *   => Assets = Liabilities + Equity + (Revenue - Expenses)
 * The last bracket is exactly the retained earnings line below.
 */
export async function getBalanceSheet(currentUser, { date } = {}) {
  const rows = await accountTotals(currentUser.companyId, { dateTo: date });

  const assetRows = ofType(rows, 'ASSET');
  const liabilityRows = ofType(rows, 'LIABILITY');
  const equityRows = ofType(rows, 'EQUITY');
  const revenueRows = ofType(rows, 'REVENUE');
  const expenseRows = ofType(rows, 'EXPENSE');

  const totalAssets = sumBy(assetRows, 'balance');
  const totalLiabilities = sumBy(liabilityRows, 'balance');
  const capital = sumBy(equityRows, 'balance');

  // Revenue balances are credit-normal and expense balances debit-normal, so
  // this is simply profit since the books began.
  const retainedEarnings = subtract(sumBy(revenueRows, 'balance'), sumBy(expenseRows, 'balance'));
  const totalEquity = add(capital, retainedEarnings);

  const liabilitiesAndEquity = add(totalLiabilities, totalEquity);

  return {
    asOfDate: date ? date.toISOString().slice(0, 10) : null,
    assets: {
      accounts: assetRows.map(publicRow),
      total: toMoneyString(totalAssets, 2),
    },
    liabilities: {
      accounts: liabilityRows.map(publicRow),
      total: toMoneyString(totalLiabilities, 2),
    },
    equity: {
      accounts: equityRows.map(publicRow),
      capital: toMoneyString(capital, 2),
      // Derived from revenue and expenses: there is no closing entry.
      retainedEarnings: toMoneyString(retainedEarnings, 2),
      total: toMoneyString(totalEquity, 2),
    },
    totalAssets: toMoneyString(totalAssets, 2),
    totalLiabilitiesAndEquity: toMoneyString(liabilitiesAndEquity, 2),
    difference: toMoneyString(subtract(totalAssets, liabilitiesAndEquity), 2),
    isBalanced: subtract(totalAssets, liabilitiesAndEquity).isZero(),
  };
}

// --- general ledger summary ------------------------------------------------

/** Per-account debit, credit and balance for a period, plus the grand totals. */
export async function getGeneralLedgerSummary(currentUser, { dateFrom, dateTo, accountId } = {}) {
  const rows = (await accountTotals(currentUser.companyId, { dateFrom, dateTo })).filter(
    (row) => !accountId || row.account.id === accountId,
  );

  const totalDebit = sumBy(rows, 'debit');
  const totalCredit = sumBy(rows, 'credit');

  return {
    fromDate: dateFrom ? dateFrom.toISOString().slice(0, 10) : null,
    toDate: dateTo ? dateTo.toISOString().slice(0, 10) : null,
    accounts: rows.map(publicRow),
    totalDebit: toMoneyString(totalDebit, 2),
    totalCredit: toMoneyString(totalCredit, 2),
    // True whenever the whole company is in view; a single-account filter is a
    // slice of the ledger and is not expected to balance on its own.
    isBalanced: accountId ? null : subtract(totalDebit, totalCredit).isZero(),
  };
}
