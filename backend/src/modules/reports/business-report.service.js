import { add, subtract, multiply, round, toDecimal, toMoneyString } from '../../utils/money.js';
import { toSkipTake, buildPagination } from '../../utils/pagination.js';
import * as dashboardRepository from './dashboard.repository.js';
import * as customerReceivableService from '../customer-receivables/customer-receivable.service.js';
import * as supplierPayableService from '../supplier-payables/supplier-payable.service.js';
import * as accountingReportService from '../accounting/report.service.js';
import * as journalService from '../accounting/journal.service.js';
import * as accountRepository from '../accounting/account.repository.js';
import * as journalRepository from '../accounting/journal.repository.js';
import { SYSTEM_ACCOUNT } from '../accounting/system-accounts.js';
import { deriveAccountBalance } from '../accounting/journal.service.js';
import { getReceivables, getPayables } from './credit.service.js';
import { getExpenseReport } from './expense-report.service.js';
import { toDateString, toPublicPeriod } from './period.js';

// The business reports.
//
// WHERE EACH ONE GETS ITS NUMBERS
//   sales, purchases, receipts, payments   the posted documents themselves
//   expenses                               the posted expense documents
//   customer / supplier outstanding        the sub-ledgers that maintain them
//   customer / supplier ledger             delegated whole to those modules
//   inventory valuation                    quantity x average cost, per balance
//   profit and loss                        the general ledger's own P&L service
//   general ledger                         the journal
//   cash and bank                          the journal, on the cash and bank accounts
//
// FOUR OF THESE ARE PURE DELEGATION. That is deliberate: a report that recomputed
// a customer ledger would be a second answer to a question that already has one,
// and the two would eventually disagree. Where a module owns a calculation, the
// report calls it and shapes the result.
//
// EVERY REPORT IS RECONCILABLE. Document reports carry their own totals so they
// can be checked against the register; ledger-derived reports are the ledger.
//
// NONE OF THIS NEEDS GST. No report in this file reads a GSTIN, a place of supply
// or a tax component. GST reporting lives in the tax module and is additional.

const MONEY_DP = 2;
const money = (value) => toMoneyString(value ?? 0, MONEY_DP);

function periodOf(query) {
  return {
    fromDate: query.fromDate ?? null,
    toDate: query.toDate ?? null,
    label: 'Selected period',
  };
}

// --- sales register --------------------------------------------------------

/**
 * Every posted invoice in the period, with what is still unpaid on each.
 *
 * The totals block is the whole period, not the page - a page total would be
 * useless for checking anything.
 */
export async function getSalesReport(currentUser, query) {
  const { companyId } = currentUser;
  const { page, limit, customerId, ...period } = query;
  const { skip, take } = toSkipTake({ page, limit });

  // The totals take the SAME filters as the list: a footer that describes a
  // different set of rows from the body is worse than no footer.
  const [{ items, total }, totals, returns] = await Promise.all([
    dashboardRepository.listSales(companyId, { skip, take, customerId, ...period }),
    dashboardRepository.sumSales(companyId, { customerId, ...period }),
    dashboardRepository.sumSalesReturns(companyId, { customerId, ...period }),
  ]);

  return {
    period: toPublicPeriod(periodOf(period)),
    invoices: items.map((invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: toDateString(invoice.invoiceDate),
      dueDate: toDateString(invoice.dueDate),
      customer: { id: invoice.customer.id, name: invoice.customerNameSnapshot },
      subtotal: money(invoice.subtotal),
      discount: money(invoice.discountTotal),
      tax: money(invoice.taxTotal),
      total: money(invoice.grandTotal),
      costOfGoodsSold: money(invoice.cogsTotal),
      grossMargin: money(
        subtract(subtract(invoice.subtotal, invoice.discountTotal), invoice.cogsTotal),
      ),
      // Straight from the receivable, which the posting transaction maintains.
      outstanding: money(invoice.receivable?.outstandingAmount),
      paid: money(invoice.receivable?.paidAmount),
      paymentStatus: invoice.receivable?.status ?? null,
    })),
    pagination: buildPagination({ page, limit, total }),
    totals: {
      description: 'The whole period, not just this page.',
      invoiceCount: totals.documentCount,
      subtotal: money(totals.subtotal),
      discount: money(totals.discountTotal),
      tax: money(totals.taxTotal),
      total: money(totals.grandTotal),
      costOfGoodsSold: money(totals.cogsTotal),
      grossMargin: money(
        subtract(subtract(totals.subtotal ?? 0, totals.discountTotal ?? 0), totals.cogsTotal ?? 0),
      ),
      returns: money(returns.grandTotal),
      returnCount: returns.documentCount,
      netSales: money(subtract(totals.grandTotal ?? 0, returns.grandTotal ?? 0)),
    },
  };
}

// --- purchase register -----------------------------------------------------

export async function getPurchasesReport(currentUser, query) {
  const { companyId } = currentUser;
  const { page, limit, supplierId, ...period } = query;
  const { skip, take } = toSkipTake({ page, limit });

  const [{ items, total }, totals, returns] = await Promise.all([
    dashboardRepository.listPurchases(companyId, { skip, take, supplierId, ...period }),
    dashboardRepository.sumPurchases(companyId, { supplierId, ...period }),
    dashboardRepository.sumPurchaseReturns(companyId, { supplierId, ...period }),
  ]);

  return {
    period: toPublicPeriod(periodOf(period)),
    bills: items.map((purchase) => ({
      id: purchase.id,
      purchaseNumber: purchase.purchaseNumber,
      supplierInvoiceNumber: purchase.invoiceNumber,
      invoiceDate: toDateString(purchase.invoiceDate),
      dueDate: toDateString(purchase.dueDate),
      supplier: { id: purchase.supplier.id, name: purchase.supplierNameSnapshot },
      subtotal: money(purchase.subtotal),
      discount: money(purchase.discountTotal),
      tax: money(purchase.taxTotal),
      total: money(purchase.grandTotal),
      outstanding: money(purchase.payable?.outstandingAmount),
      paid: money(purchase.payable?.paidAmount),
      paymentStatus: purchase.payable?.status ?? null,
    })),
    pagination: buildPagination({ page, limit, total }),
    totals: {
      description: 'The whole period, not just this page.',
      billCount: totals.documentCount,
      subtotal: money(totals.subtotal),
      discount: money(totals.discountTotal),
      tax: money(totals.taxTotal),
      total: money(totals.grandTotal),
      returns: money(returns.grandTotal),
      returnCount: returns.documentCount,
      netPurchases: money(subtract(totals.grandTotal ?? 0, returns.grandTotal ?? 0)),
    },
  };
}

// --- outstanding -----------------------------------------------------------

/** Who owes what. The credit book, presented as a report. */
export async function getCustomerOutstandingReport(currentUser, query) {
  const result = await getReceivables(currentUser, query);

  return {
    asOf: result.asOf,
    summary: result.summary,
    customers: result.customers,
    note: result.note,
  };
}

export async function getSupplierOutstandingReport(currentUser, query) {
  const result = await getPayables(currentUser, query);

  return {
    asOf: result.asOf,
    summary: result.summary,
    suppliers: result.suppliers,
    note: result.note,
  };
}

// --- ledgers (delegated whole) ---------------------------------------------

export function getCustomerLedgerReport(currentUser, customerId, query) {
  return customerReceivableService.getCustomerLedger(currentUser, customerId, query);
}

export function getSupplierLedgerReport(currentUser, supplierId, query) {
  return supplierPayableService.getSupplierLedger(currentUser, supplierId, query);
}

// --- money in and out ------------------------------------------------------

export async function getPaymentsReceivedReport(currentUser, query) {
  const { companyId } = currentUser;
  const { page, limit, customerId, ...period } = query;
  const { skip, take } = toSkipTake({ page, limit });

  const [{ items, total }, totals, byMethod] = await Promise.all([
    dashboardRepository.listCustomerPayments(companyId, { skip, take, customerId, ...period }),
    dashboardRepository.sumCustomerPayments(companyId, { customerId, ...period }),
    dashboardRepository.groupCustomerPaymentsByMethod(companyId, { customerId, ...period }),
  ]);

  return {
    period: toPublicPeriod(periodOf(period)),
    receipts: items.map((payment) => ({
      id: payment.id,
      receiptNumber: payment.paymentNumber,
      date: toDateString(payment.paymentDate),
      customer: payment.customer,
      amount: money(payment.amount),
      againstInvoices: money(payment.allocatedAmount),
      advance: money(payment.unallocatedAmount),
      method: payment.paymentMethod,
      reference: payment.referenceNumber,
    })),
    pagination: buildPagination({ page, limit, total }),
    byMethod: byMethod
      .map((row) => ({
        method: row.paymentMethod,
        count: row._count._all,
        amount: money(row._sum.amount),
      }))
      .sort((a, b) => a.method.localeCompare(b.method)),
    totals: {
      description: 'The whole period, not just this page.',
      receiptCount: totals.documentCount,
      amount: money(totals.amount),
      againstInvoices: money(totals.allocatedAmount),
      advance: money(totals.unallocatedAmount),
    },
  };
}

export async function getSupplierPaymentsReport(currentUser, query) {
  const { companyId } = currentUser;
  const { page, limit, supplierId, ...period } = query;
  const { skip, take } = toSkipTake({ page, limit });

  const [{ items, total }, totals, byMethod] = await Promise.all([
    dashboardRepository.listSupplierPayments(companyId, { skip, take, supplierId, ...period }),
    dashboardRepository.sumSupplierPayments(companyId, { supplierId, ...period }),
    dashboardRepository.groupSupplierPaymentsByMethod(companyId, { supplierId, ...period }),
  ]);

  return {
    period: toPublicPeriod(periodOf(period)),
    payments: items.map((payment) => ({
      id: payment.id,
      paymentNumber: payment.paymentNumber,
      date: toDateString(payment.paymentDate),
      supplier: payment.supplier,
      amount: money(payment.amount),
      againstBills: money(payment.allocatedAmount),
      advance: money(payment.unallocatedAmount),
      method: payment.paymentMethod,
      reference: payment.referenceNumber,
    })),
    pagination: buildPagination({ page, limit, total }),
    byMethod: byMethod
      .map((row) => ({
        method: row.paymentMethod,
        count: row._count._all,
        amount: money(row._sum.amount),
      }))
      .sort((a, b) => a.method.localeCompare(b.method)),
    totals: {
      description: 'The whole period, not just this page.',
      paymentCount: totals.documentCount,
      amount: money(totals.amount),
      againstBills: money(totals.allocatedAmount),
      advance: money(totals.unallocatedAmount),
    },
  };
}

// --- inventory valuation ---------------------------------------------------

/**
 * What is in stock and what it is worth.
 *
 * quantity x average cost, rounded per balance - the identical arithmetic the
 * inventory module publishes for a single balance, so a line here and a line
 * there can never disagree.
 */
export async function getInventoryValuationReport(currentUser, query = {}) {
  const balances = await dashboardRepository.findAllInventoryBalances(currentUser.companyId);

  const rows = balances.map((balance) => {
    const value = round(multiply(balance.quantity, balance.averageCost), MONEY_DP);
    const reorderLevel = toDecimal(balance.product.reorderLevel ?? 0);

    return {
      productId: balance.product.id,
      product: balance.product.name,
      sku: balance.product.sku,
      warehouse: balance.warehouse,
      quantity: toMoneyString(balance.quantity, 3),
      averageCost: toMoneyString(balance.averageCost, 4),
      value: money(value),
      rawValue: value,
      reorderLevel: toMoneyString(reorderLevel, 3),
      isLowStock: !reorderLevel.isZero() && toDecimal(balance.quantity).lessThanOrEqualTo(reorderLevel),
    };
  });

  const filtered = query.lowStockOnly ? rows.filter((row) => row.isLowStock) : rows;
  const totalValue = filtered.reduce((sum, row) => add(sum, row.rawValue), toDecimal(0));

  return {
    asOf: toDateString(new Date()),
    items: filtered.map(({ rawValue, ...row }) => row),
    totals: {
      itemCount: filtered.length,
      totalValue: money(totalValue),
      lowStockCount: rows.filter((row) => row.isLowStock).length,
    },
    note: 'Valued at moving weighted average cost. This is the same figure the Inventory control account carries in the general ledger, subject to the documented purchase-return valuation residue.',
  };
}

/**
 * Operating expenses for a period. Delegated whole to the expense report, which
 * counts posted expenses only.
 */
export function getExpensesReport(currentUser, query) {
  return getExpenseReport(currentUser, query);
}

// --- accounting reports (delegated) ----------------------------------------

export function getProfitAndLossReport(currentUser, query) {
  return accountingReportService.getProfitAndLoss(currentUser, {
    dateFrom: query.fromDate,
    dateTo: query.toDate,
  });
}

export function getGeneralLedgerReport(currentUser, query) {
  return journalService.listGeneralLedger(currentUser, {
    page: query.page,
    limit: query.limit,
    accountId: query.accountId,
    dateFrom: query.fromDate,
    dateTo: query.toDate,
  });
}

// --- cash and bank ---------------------------------------------------------

/**
 * Every movement of cash and bank in the period, from the journal.
 *
 * Built from the ledger rather than from receipts and payments, because those are
 * only two of the things that move money: the account itself is what knows.
 */
export async function getCashBankReport(currentUser, query) {
  const { companyId } = currentUser;
  const { page, limit, ...period } = query;
  const { skip, take } = toSkipTake({ page, limit });

  // The system Cash and Bank accounts, plus any account parented under them -
  // so a business with a second bank sees both balances rather than one.
  const accounts = await accountRepository.findCashAndBankAccounts(companyId, [
    SYSTEM_ACCOUNT.CASH,
    SYSTEM_ACCOUNT.BANK,
  ]);

  const accountIds = accounts.map((account) => account.id);

  const [movements, openingRows, periodRows] = await Promise.all([
    Promise.all(
      accountIds.map((accountId) =>
        journalRepository.findLines(companyId, {
          skip: 0,
          take: 1000,
          accountId,
          dateFrom: period.fromDate,
          dateTo: period.toDate,
        }),
      ),
    ),
    period.fromDate
      ? Promise.all(
          accountIds.map((accountId) =>
            journalRepository.sumLinesBefore(companyId, accountId, period.fromDate),
          ),
        )
      : Promise.resolve(accountIds.map(() => ({ _sum: {} }))),
    journalRepository.sumLinesGroupedByAccount(companyId, {
      dateFrom: period.fromDate,
      dateTo: period.toDate,
    }),
  ]);

  const summary = accounts.map((account, index) => {
    const opening = openingRows[index]._sum ?? {};
    const openingBalance = deriveAccountBalance(
      account.type,
      opening.debit ?? 0,
      opening.credit ?? 0,
    );

    const row = periodRows.find((entry) => entry.accountId === account.id);
    const moneyIn = row?._sum.debit ?? toDecimal(0);
    const moneyOut = row?._sum.credit ?? toDecimal(0);

    return {
      code: account.code,
      name: account.name,
      openingBalance: money(openingBalance),
      moneyIn: money(moneyIn),
      moneyOut: money(moneyOut),
      closingBalance: money(add(openingBalance, subtract(moneyIn, moneyOut))),
      rawOpening: openingBalance,
      rawIn: moneyIn,
      rawOut: moneyOut,
    };
  });

  // Every line, both accounts, oldest first.
  const lines = movements
    .flatMap((result, index) =>
      result.items.map((line) => ({
        date: toDateString(line.entryDate),
        account: { code: accounts[index].code, name: accounts[index].name },
        journalNumber: line.journalEntry.journalNumber,
        description: line.description ?? line.journalEntry.description,
        sourceType: line.journalEntry.sourceType,
        sourceId: line.journalEntry.sourceId,
        moneyIn: money(line.debit),
        moneyOut: money(line.credit),
      })),
    )
    .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? -1 : 1));

  const paged = lines.slice(skip, skip + take);

  const totals = summary.reduce(
    (acc, row) => ({
      opening: add(acc.opening, row.rawOpening),
      moneyIn: add(acc.moneyIn, row.rawIn),
      moneyOut: add(acc.moneyOut, row.rawOut),
    }),
    { opening: toDecimal(0), moneyIn: toDecimal(0), moneyOut: toDecimal(0) },
  );

  return {
    period: toPublicPeriod(periodOf(period)),
    accounts: summary.map(({ rawOpening, rawIn, rawOut, ...row }) => row),
    movements: paged,
    pagination: buildPagination({ page, limit, total: lines.length }),
    totals: {
      openingBalance: money(totals.opening),
      moneyIn: money(totals.moneyIn),
      moneyOut: money(totals.moneyOut),
      netMovement: money(subtract(totals.moneyIn, totals.moneyOut)),
      closingBalance: money(
        add(totals.opening, subtract(totals.moneyIn, totals.moneyOut)),
      ),
    },
    note: 'Built from posted journal entries on the Cash and Bank accounts, so it includes every movement of money - customer receipts, supplier payments and expenses alike. Each line traces to its source document. There are no opening balances in this system: a balance is everything the ledger has recorded, from the beginning.',
  };
}

export { money };
