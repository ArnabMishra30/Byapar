import { prisma } from '../../config/prisma.js';

// All Prisma access for the GST summaries. Every query is company scoped.
//
// The four taxable document types share one shape - lines hanging off a header -
// so they are described once in SOURCES and queried through one set of helpers.
// That is what stops "purchases counted returns but sales did not" bugs.
//
// ONLY POSTED DOCUMENTS COUNT. A draft has charged nobody any tax.

/**
 * @typedef {'PURCHASE'|'PURCHASE_RETURN'|'SALES_INVOICE'|'SALES_RETURN'} TaxSource
 */

const SOURCES = {
  PURCHASE: {
    line: () => prisma.purchaseItem,
    relation: 'purchase',
    dateField: 'invoiceDate',
    numberField: 'purchaseNumber',
    // A purchase is tax we PAID: input credit.
    direction: 'INPUT',
    sign: 1,
    // purchase_items carry taxableAmount like every other line table.
    taxableField: 'taxableAmount',
  },
  PURCHASE_RETURN: {
    line: () => prisma.purchaseReturnItem,
    relation: 'purchaseReturn',
    dateField: 'returnDate',
    numberField: 'returnNumber',
    direction: 'INPUT',
    // A return gives the credit back, so it subtracts.
    sign: -1,
    // A purchase-return line's taxable value IS its lineTotal (quantity x cost).
    taxableField: 'lineTotal',
  },
  SALES_INVOICE: {
    line: () => prisma.salesInvoiceItem,
    relation: 'salesInvoice',
    dateField: 'invoiceDate',
    numberField: 'invoiceNumber',
    // A sale is tax we COLLECTED: output liability.
    direction: 'OUTPUT',
    sign: 1,
    taxableField: 'taxableAmount',
  },
  SALES_RETURN: {
    line: () => prisma.salesReturnItem,
    relation: 'salesReturn',
    dateField: 'returnDate',
    numberField: 'returnNumber',
    direction: 'OUTPUT',
    sign: -1,
    taxableField: 'taxableAmount',
  },
};

export const TAX_SOURCES = Object.keys(SOURCES);

export function sourceConfig(source) {
  return SOURCES[source];
}

/**
 * The `where` every query in this file shares.
 *
 * @param {{ dateFrom?: Date, dateTo?: Date, stateCode?: string, gstin?: string,
 *           hsnCode?: string, taxRate?: string, supplyType?: string }} filters
 */
function buildWhere(source, companyId, filters = {}) {
  const config = SOURCES[source];
  const header = { companyId, status: 'POSTED' };

  if (filters.dateFrom || filters.dateTo) {
    header[config.dateField] = {};
    if (filters.dateFrom) header[config.dateField].gte = filters.dateFrom;
    if (filters.dateTo) header[config.dateField].lte = filters.dateTo;
  }

  if (filters.supplyType) header.supplyType = filters.supplyType;

  // The other party's state: whichever side of the document is not us.
  if (filters.stateCode) {
    header.placeOfSupplyStateCode = filters.stateCode;
  }

  // Matches whichever side carries it, so one filter works for both directions.
  if (filters.gstin) {
    const gstin = filters.gstin.trim().toUpperCase();
    header.OR = [{ sellerGstin: gstin }, { buyerGstin: gstin }];
  }

  const where = { [config.relation]: header };

  if (filters.hsnCode) where.hsnCodeSnapshot = filters.hsnCode;
  if (filters.taxRate !== undefined && filters.taxRate !== null) {
    where.taxRateSnapshot = filters.taxRate;
  }

  return where;
}

/** Grand totals for one document type. */
export function sumBySource(source, companyId, filters) {
  const config = SOURCES[source];

  return config.line().aggregate({
    where: buildWhere(source, companyId, filters),
    _sum: {
      [config.taxableField]: true,
      taxAmount: true,
      cgstAmount: true,
      sgstAmount: true,
      igstAmount: true,
      cessAmount: true,
    },
  });
}

/** Totals grouped by the rate that was actually applied - a GST return's shape. */
export function groupBySourceAndRate(source, companyId, filters) {
  const config = SOURCES[source];

  return config.line().groupBy({
    by: ['taxRateSnapshot'],
    where: buildWhere(source, companyId, filters),
    _sum: {
      [config.taxableField]: true,
      taxAmount: true,
      cgstAmount: true,
      sgstAmount: true,
      igstAmount: true,
      cessAmount: true,
    },
  });
}

/** Totals grouped by HSN/SAC. */
export function groupBySourceAndHsn(source, companyId, filters) {
  const config = SOURCES[source];

  return config.line().groupBy({
    by: ['hsnCodeSnapshot'],
    where: buildWhere(source, companyId, filters),
    _sum: {
      [config.taxableField]: true,
      taxAmount: true,
      cgstAmount: true,
      sgstAmount: true,
      igstAmount: true,
      cessAmount: true,
    },
  });
}

/**
 * Line-level detail, so every figure in a summary can be traced to the document
 * that produced it - and from there, through sourceType/sourceId, to its journal.
 */
export async function listLines(source, companyId, filters, { skip, take }) {
  const config = SOURCES[source];
  const where = buildWhere(source, companyId, filters);

  const headerSelect = {
    id: true,
    [config.numberField]: true,
    [config.dateField]: true,
    supplyType: true,
    sellerGstin: true,
    sellerStateCode: true,
    buyerGstin: true,
    buyerStateCode: true,
    placeOfSupplyStateCode: true,
  };

  const [items, total] = await Promise.all([
    config.line().findMany({
      where,
      select: {
        id: true,
        productNameSnapshot: true,
        hsnCodeSnapshot: true,
        taxTreatmentSnapshot: true,
        taxRateSnapshot: true,
        [config.taxableField]: true,
        taxAmount: true,
        cgstAmount: true,
        sgstAmount: true,
        igstAmount: true,
        cessAmount: true,
        [config.relation]: { select: headerSelect },
      },
      orderBy: { id: 'asc' },
      skip,
      take,
    }),
    config.line().count({ where }),
  ]);

  return { items, total };
}
