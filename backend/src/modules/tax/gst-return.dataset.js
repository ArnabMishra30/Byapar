import { add, subtract, round, toDecimal, toMoneyString, isZero } from '../../utils/money.js';
import { isNonTaxableTreatment } from './gst.calculator.js';
import { stateName } from './state-codes.js';

// The grouping engine behind the GST return datasets. Pure functions - no
// database, no HTTP - so every rule here can be unit tested directly.
//
// ONE CANONICAL ROW SET, MANY VIEWS
//   Each posted document line becomes exactly one `ReturnRow`. Every table in
//   every return is then a grouping of that same set. Nothing is ever recomputed
//   from a different source, which is why the tables always add up to each other.
//
// PRECISION
//   Amounts are summed as Decimals at full stored precision (4 dp) and rounded
//   ONCE, at serialization, to 2 dp - a return is filed in rupees and paise.
//   Because a component can legitimately hold 4 dp, the sum of the displayed
//   parts can in principle differ from the displayed whole by a fraction of a
//   paisa. That is not hidden: the reconciliation endpoint compares the two and
//   reports any difference explicitly.

const DISPLAY_DP = 2;

/** Why a document could not be placed in a GST return table. */
export const UNCLASSIFIED_REASON = {
  NO_PLACE_OF_SUPPLY: 'NO_PLACE_OF_SUPPLY',
};

export const SUPPLY_CATEGORY = {
  /** The counterparty had a GSTIN on the document. */
  B2B: 'B2B',
  /** No counterparty GSTIN: an unregistered buyer. */
  B2C: 'B2C',
  /** Cannot be placed in a return table at all. Never guessed at. */
  UNCLASSIFIED: 'UNCLASSIFIED',
};

// --- normalising a database row into a return row --------------------------

/**
 * Flattens one line + its header into the single shape every grouping works on.
 *
 * @param {string} source  SALES_INVOICE | SALES_RETURN | PURCHASE | PURCHASE_RETURN
 * @param {object} config  the source config from the repository
 * @param {object} row     a line row with its header relation loaded
 */
export function toReturnRow(source, config, row) {
  const header = row[config.relation];
  const original = header.salesInvoice ?? header.purchase ?? null;

  return {
    source,
    direction: config.direction,
    // +1 for an invoice, -1 for a credit note or debit note.
    sign: config.sign,

    documentId: header.id,
    documentNumber: header[config.numberField],
    documentDate: header[config.dateField],
    documentValue: header.grandTotal,

    // A credit note carries the invoice it reverses; GSTR-1 requires it.
    originalDocumentId: original?.id ?? null,
    originalDocumentNumber: original?.invoiceNumber ?? original?.purchaseNumber ?? null,
    originalDocumentDate: original?.invoiceDate ?? null,

    // On a purchase this is the SUPPLIER's own bill number, which is the
    // reference that matters for input credit.
    supplierInvoiceNumber: source === 'PURCHASE' ? header.invoiceNumber : null,

    partyName: header.customerNameSnapshot ?? header.supplierNameSnapshot ?? null,
    // The other side of the supply, whichever direction it runs in.
    counterpartyGstin: config.direction === 'OUTWARD' ? header.buyerGstin : header.sellerGstin,
    ownGstin: config.direction === 'OUTWARD' ? header.sellerGstin : header.buyerGstin,

    supplyType: header.supplyType,
    placeOfSupplyStateCode: header.placeOfSupplyStateCode,

    lineId: row.id,
    productName: row.productNameSnapshot,
    hsnCode: row.hsnCodeSnapshot,
    taxTreatment: row.taxTreatmentSnapshot,
    taxRate: row.taxRateSnapshot,

    taxableAmount: row[config.taxableField],
    cgstAmount: row.cgstAmount,
    sgstAmount: row.sgstAmount,
    igstAmount: row.igstAmount,
    cessAmount: row.cessAmount,
    taxAmount: row.taxAmount,
  };
}

// --- classification --------------------------------------------------------

/**
 * Which GST return table a row belongs to.
 *
 * A document with no supply type was written by a company that had not enabled
 * GST. It has no place of supply and no component split, so there is no lawful
 * table to put it in - and it is reported as UNCLASSIFIED with a reason rather
 * than being quietly dropped or guessed into B2C.
 */
export function classifyRow(row) {
  if (!row.supplyType || !row.placeOfSupplyStateCode) {
    return { category: SUPPLY_CATEGORY.UNCLASSIFIED, reason: UNCLASSIFIED_REASON.NO_PLACE_OF_SUPPLY };
  }

  return {
    category: row.counterpartyGstin ? SUPPLY_CATEGORY.B2B : SUPPLY_CATEGORY.B2C,
    reason: null,
  };
}

/** A supply that carries no tax by treatment, not merely by rate. */
export function isNilRatedOrExempt(row) {
  return isNonTaxableTreatment(row.taxTreatment);
}

// --- totals ----------------------------------------------------------------

export function emptyTotals() {
  return {
    taxableAmount: toDecimal(0),
    cgst: toDecimal(0),
    sgst: toDecimal(0),
    igst: toDecimal(0),
    cess: toDecimal(0),
    tax: toDecimal(0),
  };
}

/**
 * Adds one row to a running total, applying its sign.
 *
 * A credit note subtracts. That is the whole reason `sign` exists: an invoice and
 * the credit note that reverses it must net to zero, in every grouping, without
 * any table needing to know which is which.
 */
export function addRow(totals, row, { applySign = true } = {}) {
  const signed = (value) => {
    const amount = toDecimal(value ?? 0);
    return applySign && row.sign === -1 ? amount.negated() : amount;
  };

  return {
    taxableAmount: add(totals.taxableAmount, signed(row.taxableAmount)),
    cgst: add(totals.cgst, signed(row.cgstAmount)),
    sgst: add(totals.sgst, signed(row.sgstAmount)),
    igst: add(totals.igst, signed(row.igstAmount)),
    cess: add(totals.cess, signed(row.cessAmount)),
    tax: add(totals.tax, signed(row.taxAmount)),
  };
}

/** Sums rows. `applySign: false` reports a credit-note table as positive amounts. */
export function sumRows(rows, options) {
  return rows.reduce((totals, row) => addRow(totals, row, options), emptyTotals());
}

export function addTotals(a, b) {
  return {
    taxableAmount: add(a.taxableAmount, b.taxableAmount),
    cgst: add(a.cgst, b.cgst),
    sgst: add(a.sgst, b.sgst),
    igst: add(a.igst, b.igst),
    cess: add(a.cess, b.cess),
    tax: add(a.tax, b.tax),
  };
}

export function subtractTotals(a, b) {
  return {
    taxableAmount: subtract(a.taxableAmount, b.taxableAmount),
    cgst: subtract(a.cgst, b.cgst),
    sgst: subtract(a.sgst, b.sgst),
    igst: subtract(a.igst, b.igst),
    cess: subtract(a.cess, b.cess),
    tax: subtract(a.tax, b.tax),
  };
}

/** The serialized shape. Rounded once, here, and nowhere else. */
export function toPublicTotals(totals) {
  return {
    taxableAmount: toMoneyString(totals.taxableAmount, DISPLAY_DP),
    cgst: toMoneyString(totals.cgst, DISPLAY_DP),
    sgst: toMoneyString(totals.sgst, DISPLAY_DP),
    igst: toMoneyString(totals.igst, DISPLAY_DP),
    cess: toMoneyString(totals.cess, DISPLAY_DP),
    totalTax: toMoneyString(totals.tax, DISPLAY_DP),
  };
}

/**
 * The invariant every taxable row must satisfy:
 *   cgst + sgst + igst + cess === tax
 * Returns the difference, so a caller can report it rather than assert blindly.
 */
export function componentDifference(totals) {
  const components = add(add(totals.cgst, totals.sgst), add(totals.igst, totals.cess));
  return subtract(components, totals.tax);
}

// --- grouping --------------------------------------------------------------

/**
 * Groups rows by a deterministic string key.
 *
 * The key must be a string, and the result is sorted by it, so the same set of
 * documents always produces byte-for-byte the same dataset. Nothing here depends
 * on insertion order, database ordering or object key iteration.
 *
 * @returns {Array<{ key: string, meta: object, rows: object[], totals: object }>}
 */
export function groupRows(rows, keyOf, metaOf = () => ({}), options) {
  const groups = new Map();

  for (const row of rows) {
    const key = keyOf(row);
    if (!groups.has(key)) {
      groups.set(key, { key, meta: metaOf(row), rows: [] });
    }
    groups.get(key).rows.push(row);
  }

  return [...groups.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((group) => ({ ...group, totals: sumRows(group.rows, options) }));
}

/** A stable key for a rate, including "no rate at all". */
export function rateKey(row) {
  return row.taxRate === null || row.taxRate === undefined
    ? 'UNRATED'
    : toMoneyString(row.taxRate, DISPLAY_DP);
}

/** A stable key for an HSN, including "not classified". */
export function hsnKey(row) {
  return row.hsnCode ?? 'UNCLASSIFIED';
}

/** A stable key for a place of supply. */
export function placeOfSupplyKey(row) {
  return row.placeOfSupplyStateCode ?? 'UNKNOWN';
}

/** A stable key for a counterparty: the GSTIN, else the party name. */
export function partyKey(row) {
  return row.counterpartyGstin ?? `NAME:${row.partyName ?? 'UNKNOWN'}`;
}

export function toBusinessDate(value) {
  return value ? value.toISOString().slice(0, 10) : null;
}

export function withStateName(code) {
  return { stateCode: code ?? null, stateName: stateName(code) };
}

export { DISPLAY_DP, round, isZero };
