import { prisma } from '../../config/prisma.js';

// All Prisma access for GST return preparation. Every query is company scoped.
//
// WHY THIS IS SEPARATE FROM gst-report.repository.js
//   The summary repository aggregates in the database, which is right for a
//   dashboard figure. A return dataset has to be built from the SAME rows several
//   different ways at once - by GSTIN, by rate, by HSN, by place of supply - and
//   every one of those groupings has to add back up to the same total. So this
//   file reads the lines ONCE, in full, and the grouping happens in memory over a
//   single canonical set. That is what makes "no tax is lost through grouping"
//   provable rather than hopeful.
//
// WHAT IS INCLUDED
//   POSTED documents only. A draft has charged nobody any tax and a cancelled
//   document never existed for GST purposes.
//
// WHAT IS READ
//   Only frozen snapshot columns. Nothing here joins to the tax master, the
//   customer or the product, so today's configuration cannot alter a past return.

/** The four document types a GST return is built from. */
export const RETURN_SOURCES = ['SALES_INVOICE', 'SALES_RETURN', 'PURCHASE', 'PURCHASE_RETURN'];

/** The GST snapshot every line table carries, whatever the document. */
const LINE_GST_SELECT = {
  id: true,
  productNameSnapshot: true,
  hsnCodeSnapshot: true,
  taxTreatmentSnapshot: true,
  taxRateSnapshot: true,
  taxAmount: true,
  cgstAmount: true,
  sgstAmount: true,
  igstAmount: true,
  cessAmount: true,
};

/** The GST snapshot every document header carries. */
const HEADER_GST_SELECT = {
  id: true,
  status: true,
  supplyType: true,
  sellerGstin: true,
  sellerStateCode: true,
  buyerGstin: true,
  buyerStateCode: true,
  placeOfSupplyStateCode: true,
  taxTotal: true,
  grandTotal: true,
  cgstTotal: true,
  sgstTotal: true,
  igstTotal: true,
  cessTotal: true,
};

const SOURCES = {
  SALES_INVOICE: {
    line: () => prisma.salesInvoiceItem,
    relation: 'salesInvoice',
    dateField: 'invoiceDate',
    numberField: 'invoiceNumber',
    taxableField: 'taxableAmount',
    /// Outward supply: tax we collected.
    direction: 'OUTWARD',
    /// An invoice adds to the return; a credit note subtracts from it.
    sign: 1,
    header: {
      ...HEADER_GST_SELECT,
      invoiceNumber: true,
      invoiceDate: true,
      customerNameSnapshot: true,
    },
  },
  SALES_RETURN: {
    line: () => prisma.salesReturnItem,
    relation: 'salesReturn',
    dateField: 'returnDate',
    numberField: 'returnNumber',
    taxableField: 'taxableAmount',
    direction: 'OUTWARD',
    sign: -1,
    header: {
      ...HEADER_GST_SELECT,
      returnNumber: true,
      returnDate: true,
      customerNameSnapshot: true,
      // A credit note must name the invoice it reverses. GSTR-1 requires it.
      salesInvoice: { select: { id: true, invoiceNumber: true, invoiceDate: true } },
    },
  },
  PURCHASE: {
    line: () => prisma.purchaseItem,
    relation: 'purchase',
    dateField: 'invoiceDate',
    numberField: 'purchaseNumber',
    taxableField: 'taxableAmount',
    /// Inward supply: tax we paid, and may be able to reclaim.
    direction: 'INWARD',
    sign: 1,
    header: {
      ...HEADER_GST_SELECT,
      purchaseNumber: true,
      // The SUPPLIER's bill number - the document reference that matters for ITC.
      invoiceNumber: true,
      invoiceDate: true,
      supplierNameSnapshot: true,
    },
  },
  PURCHASE_RETURN: {
    line: () => prisma.purchaseReturnItem,
    relation: 'purchaseReturn',
    dateField: 'returnDate',
    numberField: 'returnNumber',
    // A purchase-return line's taxable value IS its lineTotal (quantity x cost).
    taxableField: 'lineTotal',
    direction: 'INWARD',
    sign: -1,
    header: {
      ...HEADER_GST_SELECT,
      returnNumber: true,
      returnDate: true,
      purchase: {
        select: { id: true, purchaseNumber: true, invoiceNumber: true, invoiceDate: true },
      },
    },
  },
};

export function returnSourceConfig(source) {
  return SOURCES[source];
}

/**
 * The period filter. Both bounds are INCLUSIVE and are applied to the document's
 * BUSINESS date, which is stored as a DATE column at UTC midnight - so a document
 * dated the first or the last day of a period is always inside it, whatever
 * timezone the caller is in.
 */
function buildWhere(source, companyId, { fromDate, toDate }) {
  const config = SOURCES[source];

  const header = { companyId, status: 'POSTED' };

  if (fromDate || toDate) {
    header[config.dateField] = {};
    if (fromDate) header[config.dateField].gte = fromDate;
    if (toDate) header[config.dateField].lte = toDate;
  }

  return { [config.relation]: header };
}

/**
 * Every posted line of one document type in the period, with its header.
 *
 * Deliberately unpaginated: a return dataset is all-or-nothing, and a page of it
 * would not add up. Ordered so the result is byte-for-byte deterministic for a
 * stable set of documents.
 */
export async function findPeriodLines(source, companyId, period) {
  const config = SOURCES[source];

  return config.line().findMany({
    where: buildWhere(source, companyId, period),
    select: {
      ...LINE_GST_SELECT,
      [config.taxableField]: true,
      [config.relation]: { select: config.header },
    },
    orderBy: [{ [config.relation]: { [config.dateField]: 'asc' } }, { id: 'asc' }],
  });
}

/**
 * Document-level totals, read straight from the headers.
 *
 * Used by reconciliation as an INDEPENDENT figure: the datasets are built from
 * line rows, this comes from header columns, and the two must agree. If they ever
 * do not, a document's own totals disagree with its lines and that has to surface.
 */
export async function sumPeriodDocuments(source, companyId, period) {
  const config = SOURCES[source];
  const where = buildWhere(source, companyId, period)[config.relation];

  const delegate = {
    SALES_INVOICE: prisma.salesInvoice,
    SALES_RETURN: prisma.salesReturn,
    PURCHASE: prisma.purchase,
    PURCHASE_RETURN: prisma.purchaseReturn,
  }[source];

  const [aggregate, count] = await Promise.all([
    delegate.aggregate({
      where,
      _sum: {
        taxTotal: true,
        cgstTotal: true,
        sgstTotal: true,
        igstTotal: true,
        cessTotal: true,
        grandTotal: true,
      },
    }),
    delegate.count({ where }),
  ]);

  return { sums: aggregate._sum, documentCount: count };
}

/**
 * Document numbers issued in the period, for the "documents issued" table.
 * Includes cancelled ones on purpose: that table reports the number series, and a
 * cancelled number is still a number that was taken out of the series.
 */
export async function findIssuedDocumentNumbers(source, companyId, period) {
  const config = SOURCES[source];
  const where = buildWhere(source, companyId, period)[config.relation];

  const delegate = {
    SALES_INVOICE: prisma.salesInvoice,
    SALES_RETURN: prisma.salesReturn,
  }[source];

  if (!delegate) return [];

  return delegate.findMany({
    // Drop the POSTED restriction: cancelled documents consumed a number too.
    where: { ...where, status: undefined },
    select: { [config.numberField]: true, status: true },
    orderBy: { [config.numberField]: 'asc' },
  });
}
