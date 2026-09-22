import { add, subtract, toDecimal, toMoneyString, isGreaterThan } from '../../utils/money.js';
import * as dashboardRepository from './dashboard.repository.js';
import * as customerReceivableService from '../customer-receivables/customer-receivable.service.js';
import * as supplierPayableService from '../supplier-payables/supplier-payable.service.js';
import { toDateString, addDays } from './period.js';

// The credit book - "udhaar" - answered in the six ways a shopkeeper actually
// asks it:
//
//   Who owes me money?          -> receivables, one row per customer
//   Whom do I owe?              -> payables, one row per supplier
//   How much?                   -> outstanding, per party and in total
//   Since when?                 -> the oldest unpaid bill, and its age in days
//   What payments were made?    -> the last posted receipt or payment
//   What is overdue?            -> anything past its due date
//
// THE SUB-LEDGERS ARE THE SOURCE OF TRUTH. Nothing is recomputed here: the
// per-invoice outstanding figures are the ones the customer and supplier
// sub-ledgers maintain inside the posting transaction, and the detailed ledger
// views delegate straight to those modules.
//
// GST plays no part in any of this. A shop with no GSTIN gets the identical
// credit book.

const MONEY_DP = 2;

const money = (value) => toMoneyString(value ?? 0, MONEY_DP);

/** Whole days between two business dates. Null when there is no date. */
function daysBetween(from, to) {
  if (!from || !to) return null;
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

/**
 * Ageing buckets, the way a credit report is normally read.
 * Based on the age of the oldest unpaid document.
 */
function ageingBucket(days) {
  if (days === null) return 'UNDATED';
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

/** One party's credit position, in the shape both directions share. */
function toPartyRow(row, { asOfDate, lastPayment, documentLabel }) {
  const outstanding = row.sums.outstandingAmount ?? toDecimal(0);
  const oldestDate = row.oldest?.salesInvoice?.invoiceDate ?? row.oldest?.purchase?.invoiceDate ?? null;
  const ageInDays = daysBetween(oldestDate, asOfDate);
  const overdueAmount = row.overdue?._sum.outstandingAmount ?? toDecimal(0);

  return {
    partyId: row.partyId,
    name: row.party?.name ?? null,
    phone: row.party?.phone ?? null,
    isActive: row.party?.isActive ?? null,

    // How much.
    outstanding: money(outstanding),
    billed: money(row.sums.originalAmount),
    paid: money(row.sums.paidAmount),
    credited: money(row.sums.creditAmount),
    [documentLabel]: row.invoiceCount,

    // Since when.
    oldestDocumentDate: toDateString(oldestDate),
    oldestDocumentNumber:
      row.oldest?.salesInvoice?.invoiceNumber ?? row.oldest?.purchase?.purchaseNumber ?? null,
    ageInDays,
    ageingBucket: ageingBucket(ageInDays),

    // What is overdue.
    overdue: money(overdueAmount),
    overdueCount: row.overdue?._count._all ?? 0,
    isOverdue: isGreaterThan(overdueAmount, 0),
    earliestDueDate: toDateString(row.earliestDueDate),

    // What payments were made.
    lastPayment: lastPayment
      ? {
          number: lastPayment.paymentNumber,
          date: toDateString(lastPayment.paymentDate),
          amount: money(lastPayment.amount),
        }
      : null,

    // A credit limit is stored on the party but never enforced by this system.
    creditLimit: money(row.party?.creditLimit),
  };
}

/** Totals across a party list, plus the ageing spread. */
function summarise(rows) {
  const total = rows.reduce((sum, row) => add(sum, toDecimal(row.outstanding)), toDecimal(0));
  const overdue = rows.reduce((sum, row) => add(sum, toDecimal(row.overdue)), toDecimal(0));

  const buckets = {};
  for (const row of rows) {
    buckets[row.ageingBucket] = add(
      buckets[row.ageingBucket] ?? toDecimal(0),
      toDecimal(row.outstanding),
    );
  }

  return {
    partyCount: rows.length,
    total: money(total),
    overdue: money(overdue),
    notYetDue: money(subtract(total, overdue)),
    overduePartyCount: rows.filter((row) => row.isOverdue).length,
    ageing: Object.entries(buckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([bucket, amount]) => ({ bucket, amount: money(amount) })),
  };
}

/**
 * Biggest debt first: what a shopkeeper wants to chase.
 *
 * Compared as Decimals rather than through Number, so the rule that money never
 * touches floating point holds without exception - including in a comparator.
 */
const byOutstandingDescending = (a, b) =>
  toDecimal(b.outstanding).comparedTo(toDecimal(a.outstanding));

// --- who owes me money -----------------------------------------------------

/**
 * @param {{ companyId: string }} currentUser
 * @param {{ asOfDate?: Date, overdueOnly?: boolean, minimumAmount?: string }} [query]
 */
export async function getReceivables(currentUser, query = {}) {
  const { companyId } = currentUser;
  const asOfDate = query.asOfDate ?? new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);

  const grouped = await dashboardRepository.groupReceivablesByCustomer(companyId, { asOfDate });
  const lastPayments = await dashboardRepository.findLastCustomerPayments(
    companyId,
    grouped.map((row) => row.partyId),
  );

  let rows = grouped
    .map((row) =>
      toPartyRow(row, {
        asOfDate,
        lastPayment: lastPayments.get(row.partyId),
        documentLabel: 'invoiceCount',
      }),
    )
    .sort(byOutstandingDescending);

  if (query.overdueOnly) rows = rows.filter((row) => row.isOverdue);
  if (query.minimumAmount) {
    rows = rows.filter((row) => isGreaterThan(toDecimal(row.outstanding), query.minimumAmount));
  }

  return {
    question: 'Who owes me money?',
    asOf: toDateString(asOfDate),
    summary: summarise(rows),
    customers: rows,
    note: 'Outstanding figures come from the customer sub-ledger, which is maintained inside the posting transaction of every invoice, credit note and receipt.',
  };
}

// --- whom do I owe ---------------------------------------------------------

export async function getPayables(currentUser, query = {}) {
  const { companyId } = currentUser;
  const asOfDate = query.asOfDate ?? new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);

  const grouped = await dashboardRepository.groupPayablesBySupplier(companyId, { asOfDate });
  const lastPayments = await dashboardRepository.findLastSupplierPayments(
    companyId,
    grouped.map((row) => row.partyId),
  );

  let rows = grouped
    .map((row) =>
      toPartyRow(row, {
        asOfDate,
        lastPayment: lastPayments.get(row.partyId),
        documentLabel: 'billCount',
      }),
    )
    .sort(byOutstandingDescending);

  if (query.overdueOnly) rows = rows.filter((row) => row.isOverdue);
  if (query.minimumAmount) {
    rows = rows.filter((row) => isGreaterThan(toDecimal(row.outstanding), query.minimumAmount));
  }

  return {
    question: 'Whom do I owe?',
    asOf: toDateString(asOfDate),
    summary: summarise(rows),
    suppliers: rows,
    note: 'Outstanding figures come from the supplier sub-ledger, which is maintained inside the posting transaction of every bill, debit note and payment.',
  };
}

// --- both sides at once ----------------------------------------------------

/** The whole credit book on one screen. */
export async function getCreditSummary(currentUser, query = {}) {
  const [receivables, payables] = await Promise.all([
    getReceivables(currentUser, query),
    getPayables(currentUser, query),
  ]);

  const owedToMe = toDecimal(receivables.summary.total);
  const owedByMe = toDecimal(payables.summary.total);

  return {
    asOf: receivables.asOf,
    owedToMe: {
      question: 'Who owes me money?',
      ...receivables.summary,
      topCustomers: receivables.customers.slice(0, 5),
    },
    owedByMe: {
      question: 'Whom do I owe?',
      ...payables.summary,
      topSuppliers: payables.suppliers.slice(0, 5),
    },
    // Positive means more is owed to the business than by it.
    netPosition: money(subtract(owedToMe, owedByMe)),
    netDirection: isGreaterThan(owedToMe, owedByMe) ? 'OWED_TO_ME' : 'OWED_BY_ME',
  };
}

// --- one party in detail ---------------------------------------------------

/**
 * A customer's full credit history: their ledger, their open invoices and their
 * position. Every part delegates to the customer sub-ledger, which owns it.
 */
export async function getCustomerCredit(currentUser, customerId, query = {}) {
  const [ledger, outstanding, openInvoices] = await Promise.all([
    customerReceivableService.getCustomerLedger(currentUser, customerId, query),
    customerReceivableService.getCustomerOutstanding(currentUser, customerId),
    customerReceivableService.listOutstandingReceivables(currentUser, customerId),
  ]);

  return {
    customer: ledger.customer,
    position: outstanding,
    openInvoices,
    ledger: {
      openingBalance: ledger.openingBalance,
      entries: ledger.entries,
      closingBalance: ledger.closingBalance,
    },
  };
}

/** The same for a supplier. */
export async function getSupplierCredit(currentUser, supplierId, query = {}) {
  const [ledger, outstanding, openBills] = await Promise.all([
    supplierPayableService.getSupplierLedger(currentUser, supplierId, query),
    supplierPayableService.getSupplierOutstanding(currentUser, supplierId),
    supplierPayableService.listOutstandingPayables(currentUser, supplierId),
  ]);

  return {
    supplier: ledger.supplier,
    position: outstanding,
    openBills,
    ledger: {
      openingBalance: ledger.openingBalance,
      entries: ledger.entries,
      closingBalance: ledger.closingBalance,
    },
  };
}

export { daysBetween, ageingBucket, addDays };
