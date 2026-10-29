import { ApiError } from '../../utils/api-error.js';
import { add, subtract, toDecimal, toMoneyString, isLessThan } from '../../utils/money.js';
import * as creditRepository from '../credit/credit.repository.js';
import * as partyRepository from './party.repository.js';
import { stateName } from '../tax/state-codes.js';
import { relationshipOf } from './party.service.js';
import { findStatementDocuments, findCompanyHeader } from './party-statement.repository.js';

// THE UNIFIED PARTY STATEMENT - the Vyapar-style page a shop hands a party that
// trades in both directions: "here is everything between us, and here is what
// each of us still owes the other".
//
// ONE LEDGER, TWO BALANCES.
//   Every row is a POSTED document's entry in the customer OR the supplier
//   sub-ledger. The two streams are merged into one chronological list, but the
//   running totals stay apart:
//
//     running receivable  += (customer debit  - customer credit)   // they owe us
//     running payable      += (supplier credit - supplier debit)    // we owe them
//
//   A receipt only moves the receivable; a supplier payment only moves the
//   payable. Nothing here nets one against the other - a party can owe us and
//   be owed by us at the same time, and the statement shows both figures.
//
// NOTHING IS RECALCULATED. Totals, outstanding amounts and payment status are
// read from the documents and their receivables/payables; drafts and cancelled
// documents never reached a sub-ledger, so they cannot appear. A windowed
// statement folds all earlier movement into the opening balance, so the closing
// figure is the party's true position, not just the movement inside the window.

const DP = 2;
const money = (value) => toMoneyString(value ?? 0, DP);

/** A quantity as typed, without the 6 stored decimals: "100", "0.5". */
function qty(value) {
  return toDecimal(value ?? 0)
    .toDecimalPlaces(3)
    .toString();
}

function toDateString(value) {
  return value ? value.toISOString().slice(0, 10) : null;
}

/** Oldest first, then stable by creation order and id so the page never jumps. */
function compareRows(a, b) {
  const byDate = a.entryDate.getTime() - b.entryDate.getTime();
  if (byDate !== 0) return byDate;
  const byCreated = a.createdAt.getTime() - b.createdAt.getTime();
  if (byCreated !== 0) return byCreated;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** How a ledger entry reads as a line on the statement. */
const KIND = {
  customer: {
    SALE: { kind: 'SALE', label: 'Sale' },
    PAYMENT: { kind: 'RECEIPT', label: 'Payment In' },
    SALES_RETURN: { kind: 'SALES_RETURN', label: 'Sales Return' },
    OPENING_BALANCE: { kind: 'OPENING', label: 'Opening Balance' },
  },
  supplier: {
    PURCHASE: { kind: 'PURCHASE', label: 'Purchase' },
    PAYMENT: { kind: 'PAYMENT', label: 'Payment Out' },
    PURCHASE_RETURN: { kind: 'PURCHASE_RETURN', label: 'Purchase Return' },
    OPENING_BALANCE: { kind: 'OPENING', label: 'Opening Balance' },
  },
};

/** How a stored payment method reads on the page. */
const PAYMENT_MODE_LABEL = {
  CASH: 'Cash',
  BANK: 'Bank',
  BANK_TRANSFER: 'Bank transfer',
  UPI: 'UPI',
  CHEQUE: 'Cheque',
  OTHER: 'Other',
};

/** An invoice/bill status as a shopkeeper reads it. */
const DOC_STATUS_LABEL = {
  OPEN: 'UNPAID',
  PARTIALLY_PAID: 'PARTIAL',
  PAID: 'PAID',
  CREDITED: 'CREDITED',
  CANCELLED: 'CANCELLED',
};

/** Which statement-line kinds a type filter keeps. */
const TYPE_FILTER = {
  SALES: new Set(['SALE']),
  PURCHASES: new Set(['PURCHASE']),
  RECEIPTS: new Set(['RECEIPT']),
  PAYMENTS: new Set(['PAYMENT']),
  RETURNS: new Set(['SALES_RETURN', 'PURCHASE_RETURN']),
};

function buildLine(row, doc, runReceivable, runPayable) {
  const map = KIND[row.side][row.entryType] ?? {
    kind: row.entryType,
    label: row.entryType,
  };
  // Exactly one of debit/credit is non-zero, so their sum is the gross amount
  // when there is no document behind the row (e.g. an opening balance).
  const gross = doc?.total != null ? doc.total : add(row.debit, row.credit);

  const isInvoiceLike = map.kind === 'SALE' || map.kind === 'PURCHASE';
  const isReturn = map.kind === 'SALES_RETURN' || map.kind === 'PURCHASE_RETURN';
  const isPayment = map.kind === 'RECEIPT' || map.kind === 'PAYMENT';

  let paymentStatus = null;
  // The transaction's OWN balance - the amount it put on the account the day it
  // posted. This is deliberately NOT the document's live outstanding: a payment
  // made later in the statement must not reach back and change an earlier row.
  // The running receivable/payable columns carry the movement; the live
  // outstanding is reported separately as `currentOutstanding`, clearly labelled.
  let txnBalance = toDecimal(gross);
  let receivedPaid = toDecimal(0);
  // How much of THIS document is still open right now, after every allocation -
  // a current fact, shown apart from the chronological figures above.
  let currentOutstanding = null;

  if (isInvoiceLike) {
    paymentStatus = DOC_STATUS_LABEL[doc?.paymentStatus] ?? 'UNPAID';
    currentOutstanding = doc?.outstanding != null ? toDecimal(doc.outstanding) : null;
  } else if (isReturn) {
    // A credit/debit note's own balance is its full value.
    paymentStatus = null;
  } else if (isPayment) {
    receivedPaid = toDecimal(gross);
    // A payment's own balance is the part not yet put against any document.
    txnBalance = toDecimal(doc?.unallocated ?? 0);
    paymentStatus = isLessThan(0, txnBalance) ? 'UNUSED' : 'SETTLED';
  }

  return {
    date: toDateString(row.entryDate),
    side: row.side,
    entryType: row.entryType,
    kind: map.kind,
    label: map.label,
    documentId: row.referenceId,
    documentNumber: doc?.number ?? null,
    referenceType: row.referenceType,
    // A supplier bill carries the supplier's own number; a payment its cheque /
    // UPI reference. Whichever the document has.
    reference: doc?.supplierInvoiceNumber ?? doc?.reference ?? null,
    dueDate: toDateString(doc?.dueDate ?? null),
    paymentMethod: doc?.method ?? null,
    // A receipt's / payment's own metadata, shown beneath its row. Only on
    // payment rows; null elsewhere. The method, reference and notes are read
    // straight from the stored payment and never affect any balance.
    payment: isPayment
      ? {
          mode: doc?.method ?? null,
          modeLabel: doc?.method ? PAYMENT_MODE_LABEL[doc.method] ?? doc.method : null,
          reference: doc?.reference ?? null,
          notes: doc?.notes ?? null,
          allocated: doc?.allocated != null ? money(doc.allocated) : null,
          unallocated: doc?.unallocated != null ? money(doc.unallocated) : null,
          allocations: Array.isArray(doc?.allocations)
            ? doc.allocations.map((a) => ({ documentNumber: a.documentNumber, amount: money(a.amount) }))
            : [],
        }
      : null,
    paymentStatus,
    total: money(gross),
    receivedPaid: money(receivedPaid),
    // The transaction's own amount at posting (never altered by later rows).
    txnBalance: money(txnBalance),
    // The document's current open amount after all allocations, or null. Shown
    // distinctly from txnBalance / the running balances, as "Outstanding now".
    currentOutstanding: currentOutstanding != null ? money(currentOutstanding) : null,
    debit: money(row.debit),
    credit: money(row.credit),
    // The running figures after this row, kept independent.
    receivableBalance: money(runReceivable),
    payableBalance: money(runPayable),
    // Per-document detail, present only for documents with lines.
    document: doc
      ? {
          subtotal: doc.subtotal != null ? money(doc.subtotal) : null,
          discount: doc.discount != null ? money(doc.discount) : null,
          tax: doc.tax != null ? money(doc.tax) : null,
          total: doc.total != null ? money(doc.total) : null,
          outstanding: doc.outstanding != null ? money(doc.outstanding) : null,
          paid: doc.paid != null ? money(doc.paid) : null,
          items: Array.isArray(doc.items)
            ? doc.items.map((it, index) => ({
                sno: index + 1,
                name: it.name,
                hsn: it.hsn ?? null,
                unit: it.unit ?? null,
                quantity: qty(it.quantity),
                unitPrice: money(it.unitPrice),
                discount: it.discount != null ? money(it.discount) : null,
                tax: it.tax != null ? money(it.tax) : null,
                amount: money(it.amount),
              }))
            : null,
          allocations: Array.isArray(doc.allocations)
            ? doc.allocations.map((a) => ({
                documentNumber: a.documentNumber,
                amount: money(a.amount),
              }))
            : null,
        }
      : null,
  };
}

/**
 * @param {{ companyId: string }} currentUser
 * @param {string} partyId
 * @param {{ fromDate?: Date, toDate?: Date, type?: string, search?: string, includeItems?: boolean }} [query]
 */
export async function getPartyStatement(currentUser, partyId, query = {}) {
  const { companyId } = currentUser;

  const party = await partyRepository.findByIdAndCompany(partyId, companyId);
  // Another company's party is reported exactly like one that does not exist.
  if (!party) throw ApiError.business(404, 'PARTY_NOT_FOUND', 'Party not found');

  const { fromDate, toDate, type = 'ALL', search = '', includeItems = true } = query;
  const customerId = party.customer?.id ?? null;
  const supplierId = party.supplier?.id ?? null;

  const [custRows, suppRows, openingReceivable, openingPayable, company] = await Promise.all([
    customerId
      ? creditRepository.findCustomerLedgerEntries(companyId, customerId, { fromDate, toDate })
      : [],
    supplierId
      ? creditRepository.findSupplierLedgerEntries(companyId, supplierId, { fromDate, toDate })
      : [],
    customerId && fromDate
      ? creditRepository.customerBalanceBefore(companyId, customerId, fromDate)
      : toDecimal(0),
    supplierId && fromDate
      ? creditRepository.supplierBalanceBefore(companyId, supplierId, fromDate)
      : toDecimal(0),
    findCompanyHeader(companyId),
  ]);

  const merged = [
    ...custRows.map((r) => ({ ...r, side: 'customer' })),
    ...suppRows.map((r) => ({ ...r, side: 'supplier' })),
  ].sort(compareRows);

  const documents = await findStatementDocuments(companyId, merged, { includeItems });

  // Walk the whole window keeping the two running balances independent, so each
  // row shows the party's true position at that point - filtering happens after.
  let runReceivable = toDecimal(openingReceivable);
  let runPayable = toDecimal(openingPayable);
  const period = { sales: toDecimal(0), received: toDecimal(0), purchases: toDecimal(0), paid: toDecimal(0), salesReturns: toDecimal(0), purchaseReturns: toDecimal(0) };

  const allLines = merged.map((row) => {
    if (row.side === 'customer') {
      runReceivable = add(runReceivable, subtract(row.debit, row.credit));
    } else {
      runPayable = add(runPayable, subtract(row.credit, row.debit));
    }
    const doc = documents.get(`${row.referenceType}:${row.referenceId}`);
    const line = buildLine(row, doc, runReceivable, runPayable);

    // Period totals are over the whole window, never the filtered view, so the
    // summary is the party's real position for the dates chosen.
    const gross = doc?.total != null ? doc.total : add(row.debit, row.credit);
    if (line.kind === 'SALE') period.sales = add(period.sales, gross);
    else if (line.kind === 'RECEIPT') period.received = add(period.received, gross);
    else if (line.kind === 'PURCHASE') period.purchases = add(period.purchases, gross);
    else if (line.kind === 'PAYMENT') period.paid = add(period.paid, gross);
    else if (line.kind === 'SALES_RETURN') period.salesReturns = add(period.salesReturns, gross);
    else if (line.kind === 'PURCHASE_RETURN') period.purchaseReturns = add(period.purchaseReturns, gross);

    return line;
  });

  // The type and search filters decide only which rows are shown; the balances
  // on each shown row are still the true running figures computed above.
  const needle = search.trim().toLowerCase();
  const keepType = type === 'ALL' ? null : TYPE_FILTER[type];
  const lines = allLines.filter((line) => {
    if (keepType && !keepType.has(line.kind)) return false;
    if (needle) {
      const hay = `${line.documentNumber ?? ''} ${line.reference ?? ''}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  const closingReceivable = runReceivable;
  const closingPayable = runPayable;

  return {
    party: {
      id: party.id,
      name: party.name,
      contactPerson: party.contactPerson ?? null,
      phone: party.phone ?? null,
      email: party.email ?? null,
      address:
        [party.address, party.city, party.stateCode ? stateName(party.stateCode) ?? null : null, party.pincode]
          .filter(Boolean)
          .join(', ') || null,
      gstin: party.gstin ?? null,
      stateCode: party.stateCode ?? null,
      relationship: relationshipOf(party),
      customerId,
      supplierId,
    },
    company: {
      name: company?.name ?? null,
      legalName: company?.legalName ?? null,
      address:
        [company?.registeredAddress, company?.city, company?.pincode].filter(Boolean).join(', ') ||
        null,
      phone: company?.phone ?? null,
      email: company?.email ?? null,
      gstin: company?.gstin ?? null,
      stateCode: company?.stateCode ?? null,
      stateName: company?.stateCode ? stateName(company.stateCode) ?? null : null,
    },
    period: {
      fromDate: toDateString(fromDate ?? null),
      toDate: toDateString(toDate ?? null),
      label: fromDate || toDate ? 'Selected period' : 'All transactions',
    },
    filters: { type, search: search || null, includeItems },
    generatedAt: new Date().toISOString(),
    openingReceivable: money(openingReceivable),
    openingPayable: money(openingPayable),
    lines,
    summary: {
      // Two closing figures, never one net number.
      closingReceivable: money(closingReceivable),
      closingPayable: money(closingPayable),
      // Money of the party's that we are holding (a negative balance on a side).
      customerAdvance: isLessThan(closingReceivable, 0) ? money(closingReceivable.abs()) : money(0),
      supplierAdvance: isLessThan(closingPayable, 0) ? money(closingPayable.abs()) : money(0),
      totalSales: money(period.sales),
      totalReceived: money(period.received),
      totalPurchases: money(period.purchases),
      totalPaid: money(period.paid),
      totalSalesReturns: money(period.salesReturns),
      totalPurchaseReturns: money(period.purchaseReturns),
      entryCount: merged.length,
      shownCount: lines.length,
    },
    basis:
      'Every line is an entry in the customer or supplier sub-ledger, written inside the posting transaction of the document that caused it. Receivable and payable run independently and are never netted. Drafts and cancelled documents are absent because they never reach the ledger.',
  };
}

export { money as formatStatementMoney };
