import {
  add,
  subtract,
  multiply,
  round,
  toDecimal,
  toMoneyString,
  isGreaterThan,
  isZero,
} from '../../utils/money.js';
import * as dashboardRepository from './dashboard.repository.js';
import * as companySettingsRepository from '../company-settings/company-settings.repository.js';
import * as companyRepository from '../companies/company.repository.js';
import * as accountRepository from '../accounting/account.repository.js';
import * as journalRepository from '../accounting/journal.repository.js';
import { SYSTEM_ACCOUNT } from '../accounting/system-accounts.js';
import { deriveAccountBalance } from '../accounting/journal.service.js';
import * as accountingReportService from '../accounting/report.service.js';
import { sumPostedExpenses } from './expense-report.service.js';
import * as creditRepository from '../credit/credit.repository.js';
import { deriveCreditPosition } from '../credit/credit-limit.service.js';

/**
 * A share of a whole, as a 2dp percentage string.
 *
 * Null when the whole is zero: a percentage of nothing is not a number, and
 * returning 0 would read as "none used" when the truth is "no limit set".
 * Decimal throughout, because this figure drives a credit decision.
 */
function percentOf(part, whole) {
  const total = toDecimal(whole ?? 0);
  if (isZero(total)) return null;

  const percent = toDecimal(part ?? 0).div(total).times(100);
  const clamped = isGreaterThan(percent, 100) ? toDecimal(100) : percent;
  return toMoneyString(isGreaterThan(0, clamped) ? toDecimal(0) : clamped, 2);
}
import {
  todayIn,
  toBusinessDate,
  toDateString,
  buildPeriods,
  toPublicPeriod,
  compareValues,
} from './period.js';

// The business dashboard: what happened today, what is owed, what is held.
//
// GST IS NOT A PREREQUISITE FOR ANY OF IT.
//   Every figure here comes from documents, sub-ledgers, inventory or the general
//   ledger - none of which needs a GSTIN, a place of supply or a tax split. A shop
//   that has never registered for GST gets exactly the same dashboard, with the
//   same numbers, as a registered business. `gstEnabled` is reported so a client
//   can decide whether to offer GST screens at all; nothing else depends on it.
//
// NO SECOND ACCOUNTING ENGINE.
//   Profit comes from the general ledger's own profit-and-loss service. Balances
//   come from the sub-ledgers that own them. Inventory valuation is
//   quantity x average cost, the same arithmetic the inventory module reports.
//   This service arranges those figures; it does not recompute them.

const MONEY_DP = 2;

// --- shared helpers --------------------------------------------------------

function money(value) {
  return toMoneyString(value ?? 0, MONEY_DP);
}

/**
 * Resolves the company's own "today", and the periods around it.
 *
 * A caller may pass an explicit date - useful for looking back at a past day, and
 * what makes the dashboard testable without freezing the clock.
 */
async function resolveContext(currentUser, requestedDate) {
  const [settings, company] = await Promise.all([
    companySettingsRepository.findByCompany(currentUser.companyId),
    companyRepository.findGstProfile(currentUser.companyId),
  ]);

  const timeZone = settings?.timezone ?? 'UTC';
  const today = requestedDate ?? toBusinessDate(todayIn(timeZone));

  return {
    today,
    timeZone,
    currency: settings?.currency ?? 'INR',
    // The one thing a client needs in order to know whether to show GST at all.
    gstEnabled: Boolean(company?.stateCode),
    periods: buildPeriods(today),
  };
}

/**
 * Everything that moved in one period.
 *
 * `netSales` and `netPurchases` are after returns, because a shopkeeper asking
 * "what did I sell today" means what stayed sold.
 */
async function movementFor(companyId, period) {
  const [sales, salesReturns, purchases, purchaseReturns, received, paid, expenses] =
    await Promise.all([
      dashboardRepository.sumSales(companyId, period),
      dashboardRepository.sumSalesReturns(companyId, period),
      dashboardRepository.sumPurchases(companyId, period),
      dashboardRepository.sumPurchaseReturns(companyId, period),
      dashboardRepository.sumCustomerPayments(companyId, period),
      dashboardRepository.sumSupplierPayments(companyId, period),
      // Posted expenses only: a draft has paid nobody.
      sumPostedExpenses(companyId, period),
    ]);

  const netSales = subtract(sales.grandTotal ?? 0, salesReturns.grandTotal ?? 0);
  const netPurchases = subtract(purchases.grandTotal ?? 0, purchaseReturns.grandTotal ?? 0);
  const netCogs = subtract(sales.cogsTotal ?? 0, salesReturns.cogsTotal ?? 0);

  return {
    raw: {
      netSales,
      netPurchases,
      netCogs,
      received: received.amount ?? toDecimal(0),
      paid: paid.amount ?? toDecimal(0),
      expenses: expenses.amount,
    },
    public: {
      period: toPublicPeriod(period),
      sales: {
        total: money(sales.grandTotal),
        returns: money(salesReturns.grandTotal),
        net: money(netSales),
        invoiceCount: sales.documentCount,
        returnCount: salesReturns.documentCount,
      },
      purchases: {
        total: money(purchases.grandTotal),
        returns: money(purchaseReturns.grandTotal),
        net: money(netPurchases),
        billCount: purchases.documentCount,
        returnCount: purchaseReturns.documentCount,
      },
      moneyReceived: {
        total: money(received.amount),
        againstInvoices: money(received.allocatedAmount),
        advance: money(received.unallocatedAmount),
        receiptCount: received.documentCount,
      },
      moneyPaid: {
        total: money(paid.amount),
        againstBills: money(paid.allocatedAmount),
        advance: money(paid.unallocatedAmount),
        paymentCount: paid.documentCount,
      },
      // What running the business cost: rent, electricity, salaries and the
      // rest. Posted expenses only.
      expenses: {
        total: money(expenses.amount),
        expenseCount: expenses.expenseCount,
      },
      // Cash in less cash out, on money that actually moved. Expenses are paid
      // out of Cash or Bank, so they count here too.
      netCashMovement: money(
        subtract(subtract(received.amount ?? 0, paid.amount ?? 0), expenses.amount),
      ),
      costOfGoodsSold: money(netCogs),
      grossMargin: money(subtract(subtract(netSales, sales.taxTotal ?? 0), netCogs)),
      // Gross margin less what it cost to run the business, for the same period.
      netMargin: money(
        subtract(subtract(subtract(netSales, sales.taxTotal ?? 0), netCogs), expenses.amount),
      ),
    },
  };
}

/**
 * The cash and bank position, straight from the general ledger.
 *
 * Deliberately NOT computed from receipts minus payments: those are only two of
 * the things that move cash, and the ledger is the account that knows.
 */
async function cashAndBank(companyId, period) {
  const codes = [SYSTEM_ACCOUNT.CASH, SYSTEM_ACCOUNT.BANK];

  const [accounts, allTime, inPeriod] = await Promise.all([
    accountRepository.findCashAndBankAccounts(companyId, codes),
    journalRepository.sumLinesGroupedByAccount(companyId, {}),
    journalRepository.sumLinesGroupedByAccount(companyId, {
      dateFrom: period.fromDate,
      dateTo: period.toDate,
    }),
  ]);

  const balanceFrom = (grouped, account) => {
    const row = grouped.find((entry) => entry.accountId === account.id);
    const debit = row?._sum.debit ?? toDecimal(0);
    const credit = row?._sum.credit ?? toDecimal(0);
    return {
      debit,
      credit,
      balance: deriveAccountBalance(account.type, debit, credit),
    };
  };

  const rows = accounts
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((account) => {
      const closing = balanceFrom(allTime, account);
      const movement = balanceFrom(inPeriod, account);

      return {
        code: account.code,
        name: account.name,
        moneyIn: money(movement.debit),
        moneyOut: money(movement.credit),
        netMovement: money(movement.balance),
        balance: money(closing.balance),
        rawBalance: closing.balance,
        rawMovement: movement.balance,
      };
    });

  const total = rows.reduce((sum, row) => add(sum, row.rawBalance), toDecimal(0));
  const totalMovement = rows.reduce((sum, row) => add(sum, row.rawMovement), toDecimal(0));

  return {
    accounts: rows.map(({ rawBalance, rawMovement, ...row }) => row),
    totalBalance: money(total),
    totalMovement: money(totalMovement),
    rawTotal: total,
  };
}

/**
 * Stock on hand and what it is worth.
 *
 * quantity x average cost, rounded per balance - the same arithmetic the
 * inventory module publishes, so the two can never disagree.
 */
export function summariseInventory(balances) {
  let value = toDecimal(0);
  let lowStockCount = 0;

  for (const balance of balances) {
    value = add(value, round(multiply(balance.quantity, balance.averageCost), MONEY_DP));

    const reorderLevel = toDecimal(balance.product?.reorderLevel ?? 0);
    if (!reorderLevel.isZero() && toDecimal(balance.quantity).lessThanOrEqualTo(reorderLevel)) {
      lowStockCount += 1;
    }
  }

  return {
    totalValue: money(value),
    rawValue: value,
    itemCount: balances.length,
    lowStockCount,
  };
}

// --- the dashboard ---------------------------------------------------------

/**
 * @param {{ companyId: string }} currentUser
 * @param {{ date?: Date }} [query]
 */
export async function getDashboard(currentUser, query = {}) {
  const { companyId } = currentUser;
  const context = await resolveContext(currentUser, query.date);
  const { periods, today } = context;

  const [
    todayMovement,
    yesterdayMovement,
    weekMovement,
    previousWeekMovement,
    monthMovement,
    previousMonthMovement,
    receivables,
    payables,
    overdueReceivables,
    overduePayables,
    balances,
    cash,
    profitAndLoss,
    creditCustomers,
    creditBalances,
    collectionsToday,
    supplierPaymentsToday,
  ] = await Promise.all([
    movementFor(companyId, periods.today),
    movementFor(companyId, periods.yesterday),
    movementFor(companyId, periods.thisWeek),
    movementFor(companyId, periods.previousWeek),
    movementFor(companyId, periods.thisMonth),
    movementFor(companyId, periods.previousMonth),
    dashboardRepository.sumAllReceivables(companyId),
    dashboardRepository.sumAllPayables(companyId),
    dashboardRepository.sumOverdueReceivables(companyId, today),
    dashboardRepository.sumOverduePayables(companyId, today),
    dashboardRepository.findAllInventoryBalances(companyId),
    cashAndBank(companyId, periods.today),
    // The general ledger's own P&L. Not recomputed here.
    accountingReportService.getProfitAndLoss(currentUser, {
      dateFrom: periods.thisMonth.fromDate,
      dateTo: periods.thisMonth.toDate,
    }),
    // Credit headroom across every customer, and what actually moved today.
    creditRepository.findCustomersWithCredit(companyId),
    creditRepository.customerLedgerBalances(companyId),
    creditRepository.sumCollections(companyId, {
      fromDate: periods.today.fromDate,
      toDate: periods.today.toDate,
    }),
    creditRepository.sumSupplierPayments(companyId, {
      fromDate: periods.today.fromDate,
      toDate: periods.today.toDate,
    }),
  ]);

  const inventory = summariseInventory(balances);

  const receivableTotal = receivables._sum.outstandingAmount ?? toDecimal(0);
  const payableTotal = payables._sum.outstandingAmount ?? toDecimal(0);

  // Credit headroom, summed only over customers who actually have a limit. A
  // limit of zero means unlimited, so adding it in would report a total credit
  // line of zero for a business that has set no limits at all - the opposite of
  // the truth.
  const creditRows = creditCustomers.map((customer) =>
    deriveCreditPosition({
      creditLimit: customer.creditLimit,
      outstanding: creditBalances.get(customer.id) ?? toDecimal(0),
    }),
  );
  const limited = creditRows.filter((row) => !row.isUnlimited);
  const totalCreditLimit = limited.reduce(
    (sum, row) => add(sum, toDecimal(row.creditLimit)),
    toDecimal(0),
  );
  const totalAvailableCredit = limited.reduce(
    (sum, row) => add(sum, toDecimal(row.availableCredit ?? 0)),
    toDecimal(0),
  );
  const usedCredit = subtract(totalCreditLimit, totalAvailableCredit);

  return {
    asOf: toDateString(today),
    timeZone: context.timeZone,
    currency: context.currency,
    // A client uses this to decide whether GST screens are worth showing at all.
    // Nothing else on this dashboard depends on it.
    gstEnabled: context.gstEnabled,

    today: todayMovement.public,
    thisWeek: weekMovement.public,
    thisMonth: monthMovement.public,

    comparisons: {
      description: 'Each period against the equivalent previous one.',
      salesTodayVsYesterday: compareValues(
        todayMovement.raw.netSales,
        yesterdayMovement.raw.netSales,
      ),
      salesThisWeekVsLast: compareValues(
        weekMovement.raw.netSales,
        previousWeekMovement.raw.netSales,
      ),
      salesThisMonthVsLast: compareValues(
        monthMovement.raw.netSales,
        previousMonthMovement.raw.netSales,
      ),
      purchasesThisMonthVsLast: compareValues(
        monthMovement.raw.netPurchases,
        previousMonthMovement.raw.netPurchases,
      ),
      collectionsThisMonthVsLast: compareValues(
        monthMovement.raw.received,
        previousMonthMovement.raw.received,
      ),
      expensesThisMonthVsLast: compareValues(
        monthMovement.raw.expenses,
        previousMonthMovement.raw.expenses,
      ),
    },

    // What the business is owed, owes, holds and has.
    balances: {
      customerReceivables: {
        total: money(receivableTotal),
        invoiceCount: receivables._count._all,
        overdue: money(overdueReceivables._sum.outstandingAmount),
        overdueCount: overdueReceivables._count._all,
      },
      supplierPayables: {
        total: money(payableTotal),
        billCount: payables._count._all,
        overdue: money(overduePayables._sum.outstandingAmount),
        overdueCount: overduePayables._count._all,
      },
      // Positive means more is owed to us than by us.
      netCreditPosition: money(subtract(receivableTotal, payableTotal)),

      // How much credit the business has extended, and how much is left.
      //
      // Only customers with a positive limit are counted: a limit of 0 means
      // unlimited, and averaging "no limit" into a total would be meaningless.
      customerCredit: {
        customersWithLimit: limited.length,
        customersWithoutLimit: creditRows.length - limited.length,
        totalCreditLimit: money(totalCreditLimit),
        availableCredit: money(totalAvailableCredit),
        utilisationPercent: percentOf(usedCredit, totalCreditLimit),
        overLimitCount: creditRows.filter(
          (row) =>
            !row.isUnlimited &&
            isGreaterThan(toDecimal(row.outstanding), toDecimal(row.creditLimit)),
        ).length,
        note: 'A credit limit of 0 means unlimited and is excluded from these totals.',
      },
      cashAndBank: cash,
      inventory: {
        totalValue: inventory.totalValue,
        itemCount: inventory.itemCount,
        lowStockCount: inventory.lowStockCount,
      },
    },

    // What actually moved today on the credit book, from posted receipts and
    // payments. This is money COLLECTED and PAID, not money billed.
    collections: {
      description: 'Posted receipts and supplier payments dated today.',
      date: toDateString(today),
      received: {
        total: money(collectionsToday._sum.amount),
        allocated: money(collectionsToday._sum.allocatedAmount),
        // Received but not applied to an invoice: credit held for the customer.
        unallocated: money(collectionsToday._sum.unallocatedAmount),
        receiptCount: collectionsToday._count._all,
      },
      paid: {
        total: money(supplierPaymentsToday._sum.amount),
        allocated: money(supplierPaymentsToday._sum.allocatedAmount),
        unallocated: money(supplierPaymentsToday._sum.unallocatedAmount),
        paymentCount: supplierPaymentsToday._count._all,
      },
      net: money(
        subtract(collectionsToday._sum.amount ?? 0, supplierPaymentsToday._sum.amount ?? 0),
      ),
    },

    // Straight from the general ledger, for the month to date.
    //
    //   Gross profit  = revenue net of returns and tax, less cost of goods sold
    //   Net profit    = gross profit, less operating expenses
    //
    // Operating expenses are the posted expense documents. Both figures come from
    // the same journal entries the profit and loss reads, so the dashboard and
    // the P&L report can never disagree.
    profit: {
      description: 'Month to date, from the general ledger.',
      period: toPublicPeriod(periods.thisMonth),
      revenue: profitAndLoss.revenue.total,
      salesReturns: profitAndLoss.salesReturns.total,
      netRevenue: profitAndLoss.netRevenue,
      costOfGoodsSold: profitAndLoss.costOfGoodsSold.total,
      grossProfit: profitAndLoss.grossProfit,
      operatingExpenses: profitAndLoss.otherExpenses.total,
      // Kept under its old name too, so nothing reading the previous shape breaks.
      otherExpenses: profitAndLoss.otherExpenses.total,
      netProfit: profitAndLoss.netProfit,
      basis:
        'Derived from posted journal entries. Operating expenses are the posted expense documents; anything the business has not recorded as an expense cannot appear.',
    },
  };
}

export { money, resolveContext, movementFor, cashAndBank };
