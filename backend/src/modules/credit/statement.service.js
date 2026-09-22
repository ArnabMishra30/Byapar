import { ApiError } from '../../utils/api-error.js';
import { add, subtract, toDecimal, toMoneyString } from '../../utils/money.js';
import * as creditRepository from './credit.repository.js';
import { toPublicCreditTerms } from './credit-limit.service.js';

// PARTY STATEMENTS - the document you hand a customer when they ask "what do I
// actually owe you, and for what?".
//
// A statement CREATES NO FINANCIAL FACT. Every line is a row that already exists
// in the customer or supplier sub-ledger, written inside the posting transaction
// of the document that caused it. This service reads those rows, attaches the
// document number behind each one, and runs a balance down the page. Nothing is
// recomputed and nothing is stored.
//
// THE RUNNING BALANCE IS THE POINT.
//   opening balance
//     + every debit
//     - every credit
//     = closing balance
//
//   A windowed statement does not lose history: everything before `fromDate` is
//   summed into the opening balance, so the closing figure is the party's real
//   position and not just the movement inside the window.
//
// SIGN, stated per side so neither can be read the wrong way round:
//   Customer  positive means THEY owe US.       Sales debit, receipts credit.
//   Supplier  positive means WE owe THEM.       Bills credit, payments debit.
//
// GST plays no part here. A shop with no registration gets the identical
// statement; nothing in this file reads a GSTIN, a tax rate or a place of supply.

const DISPLAY_DP = 2;
const money = (value) => toMoneyString(value ?? 0, DISPLAY_DP);

function toDateString(value) {
  return value ? value.toISOString().slice(0, 10) : null;
}

/** How a ledger entry type reads on a statement a human is holding. */
const CUSTOMER_LINE_LABEL = {
  SALE: 'Invoice',
  PAYMENT: 'Receipt',
  SALES_RETURN: 'Credit note',
};

const SUPPLIER_LINE_LABEL = {
  PURCHASE: 'Bill',
  PAYMENT: 'Payment',
  PURCHASE_RETURN: 'Debit note',
};

/**
 * Turns ledger rows into statement lines with a running balance.
 *
 * @param {object[]} rows        ledger entries, oldest first
 * @param {Map} documents        `${referenceType}:${referenceId}` -> document
 * @param {Decimal} opening      the balance the window opens on
 * @param {(row: object) => Decimal} movementOf  signed effect on the balance
 * @param {Record<string,string>} labels
 */
function toLines(rows, documents, opening, movementOf, labels) {
  let balance = opening;

  return rows.map((row) => {
    balance = add(balance, movementOf(row));
    const document = documents.get(`${row.referenceType}:${row.referenceId}`);

    return {
      date: toDateString(row.entryDate),
      type: row.entryType,
      // What a person reading the page calls this line.
      label: labels[row.entryType] ?? row.entryType,
      // The document number, fetched from the source rather than copied onto the
      // ledger - one fact, one home.
      documentNumber: document?.number ?? null,
      documentId: row.referenceId,
      referenceType: row.referenceType,
      // A supplier bill carries the supplier's own invoice number too; a receipt
      // carries the cheque or UPI reference. Whichever exists.
      reference: document?.supplierInvoiceNumber ?? document?.reference ?? null,
      dueDate: toDateString(document?.dueDate ?? null),
      description: row.description,
      debit: money(row.debit),
      credit: money(row.credit),
      balance: money(balance),
    };
  });
}

/** Totals of a column set, so the foot of the statement adds up on inspection. */
function totalsOf(rows, opening, closing) {
  const debit = rows.reduce((sum, row) => add(sum, row.debit), toDecimal(0));
  const credit = rows.reduce((sum, row) => add(sum, row.credit), toDecimal(0));

  return {
    openingBalance: money(opening),
    totalDebit: money(debit),
    totalCredit: money(credit),
    closingBalance: money(closing),
    entryCount: rows.length,
  };
}

// --- customer --------------------------------------------------------------

/**
 * @param {{ companyId: string }} currentUser
 * @param {string} customerId
 * @param {{ fromDate?: Date, toDate?: Date }} [query]
 */
export async function getCustomerStatement(currentUser, customerId, query = {}) {
  const { companyId } = currentUser;

  const customer = await creditRepository.findCustomerById(companyId, customerId);
  // Another company's customer is reported exactly like a non-existent one.
  if (!customer) throw ApiError.business(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');

  const [rows, opening] = await Promise.all([
    creditRepository.findCustomerLedgerEntries(companyId, customerId, query),
    query.fromDate
      ? creditRepository.customerBalanceBefore(companyId, customerId, query.fromDate)
      : Promise.resolve(toDecimal(0)),
  ]);

  const documents = await creditRepository.findDocumentNumbers(companyId, rows);

  // A customer's debit raises what they owe; their credit lowers it.
  const lines = toLines(
    rows,
    documents,
    opening,
    (row) => subtract(row.debit, row.credit),
    CUSTOMER_LINE_LABEL,
  );

  const closing = rows.reduce(
    (balance, row) => add(balance, subtract(row.debit, row.credit)),
    opening,
  );

  return {
    party: {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      ...toPublicCreditTerms(customer),
    },
    period: {
      fromDate: toDateString(query.fromDate ?? null),
      toDate: toDateString(query.toDate ?? null),
      label: query.fromDate || query.toDate ? 'Selected period' : 'Everything so far',
    },
    openingBalance: money(opening),
    lines,
    closingBalance: money(closing),
    totals: totalsOf(rows, opening, closing),
    balanceMeaning:
      'Positive means the customer owes the business. Negative means the business is holding their money as an advance.',
    basis:
      'Every line is an entry in the customer sub-ledger, written inside the posting transaction of the invoice, receipt or credit note that caused it. Nothing here is recalculated, and drafts and cancelled documents are absent because they never reach the ledger.',
  };
}

// --- supplier --------------------------------------------------------------

export async function getSupplierStatement(currentUser, supplierId, query = {}) {
  const { companyId } = currentUser;

  const supplier = await creditRepository.findSupplierById(companyId, supplierId);
  if (!supplier) throw ApiError.business(404, 'SUPPLIER_NOT_FOUND', 'Supplier not found');

  const [rows, opening] = await Promise.all([
    creditRepository.findSupplierLedgerEntries(companyId, supplierId, query),
    query.fromDate
      ? creditRepository.supplierBalanceBefore(companyId, supplierId, query.fromDate)
      : Promise.resolve(toDecimal(0)),
  ]);

  const documents = await creditRepository.findDocumentNumbers(companyId, rows);

  // The mirror image: a supplier's credit raises what we owe them.
  const lines = toLines(
    rows,
    documents,
    opening,
    (row) => subtract(row.credit, row.debit),
    SUPPLIER_LINE_LABEL,
  );

  const closing = rows.reduce(
    (balance, row) => add(balance, subtract(row.credit, row.debit)),
    opening,
  );

  return {
    party: {
      id: supplier.id,
      name: supplier.name,
      phone: supplier.phone,
      email: supplier.email,
      ...toPublicCreditTerms(supplier),
    },
    period: {
      fromDate: toDateString(query.fromDate ?? null),
      toDate: toDateString(query.toDate ?? null),
      label: query.fromDate || query.toDate ? 'Selected period' : 'Everything so far',
    },
    openingBalance: money(opening),
    lines,
    closingBalance: money(closing),
    totals: totalsOf(rows, opening, closing),
    balanceMeaning:
      'Positive means the business owes the supplier. Negative means the business has paid them in advance.',
    basis:
      'Every line is an entry in the supplier sub-ledger, written inside the posting transaction of the bill, payment or debit note that caused it. Nothing here is recalculated, and drafts and cancelled documents are absent because they never reach the ledger.',
  };
}

export { money, toDateString };
