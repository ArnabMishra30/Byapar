import { ApiError } from '../../utils/api-error.js';
import { add, subtract, toDecimal, toMoneyString, isGreaterThan } from '../../utils/money.js';
import * as creditRepository from './credit.repository.js';
import { deriveCreditPosition, isUnlimited } from './credit-limit.service.js';
import { toDateString, addDays } from '../reports/period.js';

// COLLECTIONS - what is owed, what is late, and what to chase first.
//
// THE CANONICAL FIGURES ARE ALREADY MAINTAINED ELSEWHERE, so nothing here
// recomputes them:
//   what a party owes in total   -> the sub-ledger balance
//   what is left on one invoice  -> CustomerReceivable.outstandingAmount
//   what was collected           -> posted CustomerPayment rows
// This service groups those three, applies the ageing rule, and sorts.
//
// OVERDUE NEEDS A DUE DATE. An invoice with no due date is outstanding but never
// overdue: nobody agreed a date, so nothing has been missed. Saying otherwise
// would invent a broken promise. `undatedOutstanding` reports exactly how much
// sits in that state, so it is visible rather than quietly excluded - and
// customer credit terms now let a business stop producing undated invoices.
//
// AGEING IS BY DUE DATE, not by invoice date. "60 days old" and "60 days late"
// are different questions, and a collections list is asking the second.

const DISPLAY_DP = 2;
const money = (value) => toMoneyString(value ?? 0, DISPLAY_DP);

/** Whole days between two business dates. */
function daysBetween(from, to) {
  if (!from || !to) return null;
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

/**
 * The standard receivables ageing ladder, measured in days past due.
 *
 * NOT_DUE covers anything still inside its terms. UNDATED is its own bucket
 * rather than being folded into NOT_DUE, because "not late" and "no date was
 * ever agreed" are different facts and a collections clerk needs to tell them
 * apart.
 */
export function overdueBucket(daysPastDue) {
  if (daysPastDue === null) return 'UNDATED';
  if (daysPastDue <= 0) return 'NOT_DUE';
  if (daysPastDue <= 30) return '1-30';
  if (daysPastDue <= 60) return '31-60';
  if (daysPastDue <= 90) return '61-90';
  return '90+';
}

const BUCKET_ORDER = ['NOT_DUE', '1-30', '31-60', '61-90', '90+', 'UNDATED'];

/** Every bucket always present, so a client never has to handle a missing key. */
function emptyBuckets() {
  return Object.fromEntries(
    BUCKET_ORDER.map((bucket) => [bucket, { amount: toDecimal(0), documentCount: 0 }]),
  );
}

function publishBuckets(buckets) {
  return BUCKET_ORDER.map((bucket) => ({
    bucket,
    amount: money(buckets[bucket].amount),
    documentCount: buckets[bucket].documentCount,
  }));
}

/**
 * Ages a set of open documents into buckets, and returns per-party totals too -
 * one pass over the same rows, so the buckets and the party list can never
 * disagree about the same money.
 */
function ageDocuments(documents, asOfDate, { partyKey, partyOf, numberOf, dateOf }) {
  const buckets = emptyBuckets();
  const parties = new Map();
  let total = toDecimal(0);
  let overdue = toDecimal(0);
  let undated = toDecimal(0);

  for (const row of documents) {
    const amount = toDecimal(row.outstandingAmount);
    const daysPastDue = row.dueDate ? daysBetween(row.dueDate, asOfDate) : null;
    const bucket = overdueBucket(daysPastDue);

    buckets[bucket].amount = add(buckets[bucket].amount, amount);
    buckets[bucket].documentCount += 1;
    total = add(total, amount);
    if (daysPastDue !== null && daysPastDue > 0) overdue = add(overdue, amount);
    if (daysPastDue === null) undated = add(undated, amount);

    const id = row[partyKey];
    if (!parties.has(id)) {
      parties.set(id, {
        partyId: id,
        name: partyOf(row).name,
        outstanding: toDecimal(0),
        overdue: toDecimal(0),
        documentCount: 0,
        overdueCount: 0,
        oldestDueDate: null,
        maxDaysPastDue: null,
        oldestDocumentNumber: null,
      });
    }

    const party = parties.get(id);
    party.outstanding = add(party.outstanding, amount);
    party.documentCount += 1;

    if (daysPastDue !== null && daysPastDue > 0) {
      party.overdue = add(party.overdue, amount);
      party.overdueCount += 1;

      // The oldest unpaid bill is what a chase call opens with.
      if (party.maxDaysPastDue === null || daysPastDue > party.maxDaysPastDue) {
        party.maxDaysPastDue = daysPastDue;
        party.oldestDueDate = row.dueDate;
        party.oldestDocumentNumber = numberOf(row);
      }
    }
  }

  return { buckets, parties, total, overdue, undated };
}

function toPartyRow(party) {
  return {
    partyId: party.partyId,
    name: party.name,
    outstanding: money(party.outstanding),
    overdue: money(party.overdue),
    documentCount: party.documentCount,
    overdueCount: party.overdueCount,
    oldestDueDate: toDateString(party.oldestDueDate),
    daysPastDue: party.maxDaysPastDue,
    overdueBucket: overdueBucket(party.maxDaysPastDue),
  };
}

/**
 * Most overdue first, and the amount decides ties.
 *
 * Sorted on Decimals rather than through Number, so the rule that money never
 * touches floating point holds inside a comparator too.
 */
const byOverdueDescending = (a, b) => {
  const byAmount = toDecimal(b.overdue).comparedTo(toDecimal(a.overdue));
  if (byAmount !== 0) return byAmount;
  return (b.daysPastDue ?? 0) - (a.daysPastDue ?? 0);
};

function resolveAsOf(asOfDate) {
  return asOfDate ?? new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
}

// --- the collection summary ------------------------------------------------

/**
 * Everything a person chasing money needs on one screen.
 *
 * @param {{ companyId: string }} currentUser
 * @param {{ asOfDate?: Date, dueWithinDays?: number, limit?: number }} [query]
 */
export async function getCollectionSummary(currentUser, query = {}) {
  const { companyId } = currentUser;
  const asOfDate = resolveAsOf(query.asOfDate);
  const dueWithinDays = query.dueWithinDays ?? 7;
  const topLimit = query.limit ?? 10;

  // The window for "falling due soon": from today up to and including the horizon.
  const dueHorizon = addDays(asOfDate, dueWithinDays);

  const [openReceivables, collectionsToday, collectionsThisPeriod, dueSoonRows] =
    await Promise.all([
      creditRepository.findOpenReceivables(companyId),
      creditRepository.sumCollections(companyId, { fromDate: asOfDate, toDate: asOfDate }),
      creditRepository.sumCollections(companyId, {
        fromDate: query.fromDate ?? null,
        toDate: query.toDate ?? asOfDate,
      }),
      creditRepository.groupReceivablesDueBetween(companyId, asOfDate, dueHorizon),
    ]);

  const aged = ageDocuments(openReceivables, asOfDate, {
    partyKey: 'customerId',
    partyOf: (row) => row.customer,
    numberOf: (row) => row.salesInvoice?.invoiceNumber ?? null,
    dateOf: (row) => row.salesInvoice?.invoiceDate ?? null,
  });

  const parties = [...aged.parties.values()].map(toPartyRow);
  const overdueParties = parties.filter((party) => isGreaterThan(toDecimal(party.overdue), 0));

  const dueSoonTotal = dueSoonRows.reduce(
    (sum, row) => add(sum, row._sum.outstandingAmount ?? 0),
    toDecimal(0),
  );

  return {
    asOf: toDateString(asOfDate),

    outstanding: {
      total: money(aged.total),
      overdue: money(aged.overdue),
      notYetDue: money(subtract(subtract(aged.total, aged.overdue), aged.undated)),
      // Outstanding, but no due date was ever agreed. Never counted as overdue.
      undated: money(aged.undated),
      invoiceCount: openReceivables.length,
      customerCount: parties.length,
      overdueCustomerCount: overdueParties.length,
    },

    dueSoon: {
      description: `Falling due in the next ${dueWithinDays} day(s), not yet paid.`,
      fromDate: toDateString(asOfDate),
      toDate: toDateString(dueHorizon),
      total: money(dueSoonTotal),
      invoiceCount: dueSoonRows.reduce((sum, row) => sum + row._count._all, 0),
      customerCount: dueSoonRows.length,
    },

    collected: {
      today: {
        date: toDateString(asOfDate),
        total: money(collectionsToday._sum.amount),
        receiptCount: collectionsToday._count._all,
      },
      period: {
        fromDate: toDateString(query.fromDate ?? null),
        toDate: toDateString(query.toDate ?? asOfDate),
        total: money(collectionsThisPeriod._sum.amount),
        allocated: money(collectionsThisPeriod._sum.allocatedAmount),
        // Money received that no invoice has claimed: the customer is in credit.
        unallocated: money(collectionsThisPeriod._sum.unallocatedAmount),
        receiptCount: collectionsThisPeriod._count._all,
      },
      basis: 'Posted receipts only. A draft receipt has collected nothing and a cancelled one never did.',
    },

    // Both readings of the same rows, so they always add to the same total.
    ageing: publishBuckets(aged.buckets),
    topOverdueCustomers: [...overdueParties].sort(byOverdueDescending).slice(0, topLimit),

    note: 'Outstanding figures are the per-invoice balances the customer sub-ledger maintains inside every posting transaction. Ageing is measured against the DUE date, not the invoice date: an invoice with no due date is outstanding but never overdue.',
  };
}

/** The supplier-side mirror: what the business owes and how late it is. */
export async function getPayablesSummary(currentUser, query = {}) {
  const { companyId } = currentUser;
  const asOfDate = resolveAsOf(query.asOfDate);
  const topLimit = query.limit ?? 10;

  const [openPayables, paidToday] = await Promise.all([
    creditRepository.findOpenPayables(companyId),
    creditRepository.sumSupplierPayments(companyId, { fromDate: asOfDate, toDate: asOfDate }),
  ]);

  const aged = ageDocuments(openPayables, asOfDate, {
    partyKey: 'supplierId',
    partyOf: (row) => row.supplier,
    numberOf: (row) => row.purchase?.purchaseNumber ?? null,
    dateOf: (row) => row.purchase?.invoiceDate ?? null,
  });

  const parties = [...aged.parties.values()].map(toPartyRow);
  const overdueParties = parties.filter((party) => isGreaterThan(toDecimal(party.overdue), 0));

  return {
    asOf: toDateString(asOfDate),
    outstanding: {
      total: money(aged.total),
      overdue: money(aged.overdue),
      notYetDue: money(subtract(subtract(aged.total, aged.overdue), aged.undated)),
      undated: money(aged.undated),
      billCount: openPayables.length,
      supplierCount: parties.length,
      overdueSupplierCount: overdueParties.length,
    },
    paid: {
      today: {
        date: toDateString(asOfDate),
        total: money(paidToday._sum.amount),
        paymentCount: paidToday._count._all,
      },
      basis: 'Posted supplier payments only.',
    },
    ageing: publishBuckets(aged.buckets),
    topOverdueSuppliers: [...overdueParties].sort(byOverdueDescending).slice(0, topLimit),
    note: 'Outstanding figures are the per-bill balances the supplier sub-ledger maintains inside every posting transaction.',
  };
}

// --- credit exposure across every customer ---------------------------------

/**
 * Who is near or past their credit limit.
 *
 * Customers with no limit set are counted in the totals but are never "over",
 * because zero means unlimited.
 */
export async function getCreditExposure(currentUser, query = {}) {
  const { companyId } = currentUser;
  const asOfDate = resolveAsOf(query.asOfDate);

  const [customers, balances, overdueRows] = await Promise.all([
    creditRepository.findCustomersWithCredit(companyId),
    creditRepository.customerLedgerBalances(companyId),
    creditRepository.groupOverdueReceivables(companyId, asOfDate),
  ]);

  const overdueBy = new Map(
    overdueRows.map((row) => [row.customerId, row._sum.outstandingAmount ?? toDecimal(0)]),
  );

  const rows = customers
    .map((customer) => {
      const outstanding = balances.get(customer.id) ?? toDecimal(0);
      const position = deriveCreditPosition({
        creditLimit: customer.creditLimit,
        outstanding,
      });

      return {
        customerId: customer.id,
        name: customer.name,
        phone: customer.phone,
        isActive: customer.isActive,
        creditDays: customer.creditDays ?? null,
        ...position,
        overdue: money(overdueBy.get(customer.id) ?? 0),
        // Over the limit right now, with no new invoice in play.
        isOverLimit:
          !position.isUnlimited &&
          isGreaterThan(toDecimal(position.outstanding), toDecimal(position.creditLimit)),
      };
    })
    // A customer who owes nothing and has no limit set tells nobody anything.
    .filter(
      (row) =>
        !isUnlimited(row.creditLimit) || isGreaterThan(toDecimal(row.outstanding), 0),
    );

  const withLimits = rows.filter((row) => !row.isUnlimited);
  const totalOutstanding = rows.reduce((sum, row) => add(sum, toDecimal(row.outstanding)), toDecimal(0));
  const totalLimit = withLimits.reduce((sum, row) => add(sum, toDecimal(row.creditLimit)), toDecimal(0));
  const totalAvailable = withLimits.reduce(
    (sum, row) => add(sum, toDecimal(row.availableCredit ?? 0)),
    toDecimal(0),
  );

  return {
    asOf: toDateString(asOfDate),
    summary: {
      customerCount: rows.length,
      customersWithLimit: withLimits.length,
      customersWithoutLimit: rows.length - withLimits.length,
      totalOutstanding: money(totalOutstanding),
      totalCreditLimit: money(totalLimit),
      totalAvailableCredit: money(totalAvailable),
      overLimitCount: rows.filter((row) => row.isOverLimit).length,
    },
    customers: rows.sort((a, b) =>
      toDecimal(b.outstanding).comparedTo(toDecimal(a.outstanding)),
    ),
    policy:
      'A credit limit of 0 means UNLIMITED - it is the default every customer carries, so treating it as "no credit" would refuse every existing sale. Only a positive limit is enforced.',
  };
}

// --- one customer's credit position ----------------------------------------

/**
 * The credit summary for a single customer: terms, exposure, headroom and what
 * is late.
 */
export async function getCustomerCreditSummary(currentUser, customerId, query = {}) {
  const { companyId } = currentUser;
  const asOfDate = resolveAsOf(query.asOfDate);

  const customer = await creditRepository.findCustomerById(companyId, customerId);
  if (!customer) throw ApiError.business(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');

  const [outstanding, openReceivables, collections] = await Promise.all([
    creditRepository.customerLedgerBalance(companyId, customerId),
    creditRepository.findOpenReceivables(companyId),
    creditRepository.groupCollectionsByCustomer(companyId, {}),
  ]);

  const mine = openReceivables.filter((row) => row.customerId === customerId);
  const aged = ageDocuments(mine, asOfDate, {
    partyKey: 'customerId',
    partyOf: (row) => row.customer,
    numberOf: (row) => row.salesInvoice?.invoiceNumber ?? null,
    dateOf: (row) => row.salesInvoice?.invoiceDate ?? null,
  });

  const position = deriveCreditPosition({
    creditLimit: customer.creditLimit,
    outstanding,
  });

  const collected = collections.find((row) => row.customerId === customerId);
  const party = aged.parties.get(customerId);

  return {
    customer: {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      isActive: customer.isActive,
    },
    asOf: toDateString(asOfDate),

    terms: {
      creditLimit: position.creditLimit,
      isUnlimited: position.isUnlimited,
      creditDays: customer.creditDays ?? null,
      description: position.isUnlimited
        ? 'No credit limit is set for this customer. A limit of 0 means unlimited.'
        : `Sales are refused once ${customer.name} would owe more than ${position.creditLimit}, unless an admin overrides.`,
    },

    position: {
      // From the ledger, which nets any advance the customer has paid.
      outstanding: position.outstanding,
      availableCredit: position.availableCredit,
      utilisationPercent: position.utilisationPercent,
      isOverLimit:
        !position.isUnlimited &&
        isGreaterThan(toDecimal(position.outstanding), toDecimal(position.creditLimit)),
      // The sum of the open invoices; differs from `outstanding` only by any
      // receipt the customer has paid that no invoice has claimed.
      invoiceOutstanding: money(aged.total),
      openInvoiceCount: mine.length,
    },

    overdue: {
      amount: money(aged.overdue),
      invoiceCount: party?.overdueCount ?? 0,
      oldestDueDate: toDateString(party?.oldestDueDate ?? null),
      daysPastDue: party?.maxDaysPastDue ?? null,
      undated: money(aged.undated),
    },

    ageing: publishBuckets(aged.buckets),

    lifetime: {
      collected: money(collected?._sum.amount ?? 0),
      receiptCount: collected?._count._all ?? 0,
    },

    basis:
      'Outstanding is the customer sub-ledger balance: invoices raise it, receipts and credit notes reduce it. Drafts and cancelled documents never reach the ledger, so they cannot appear here.',
  };
}

export { money, daysBetween, ageDocuments, BUCKET_ORDER };
