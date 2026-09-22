import { toMoneyString } from '../../utils/money.js';
import * as gstReturnRepository from './gst-return.repository.js';
import {
  toReturnRow,
  classifyRow,
  isNilRatedOrExempt,
  sumRows,
  groupRows,
  toPublicTotals,
  rateKey,
  hsnKey,
  placeOfSupplyKey,
  partyKey,
  toBusinessDate,
  withStateName,
  SUPPLY_CATEGORY,
  DISPLAY_DP,
} from './gst-return.dataset.js';

// GSTR-1 PREPARATION DATASET - outward supplies.
//
// THIS IS PREPARATION DATA, NOT A FILED RETURN.
//   It is built from this system's own posted documents. It is not validated
//   against the GST portal, it does not carry every statutory field, and nothing
//   here is submitted anywhere. See `notFiled` on every response and the
//   limitations in docs/architecture.md.
//
// WHAT GOES IN
//   POSTED sales invoices and POSTED sales returns whose BUSINESS DATE falls in
//   the period, both bounds inclusive. Drafts and cancelled documents are not
//   outward supplies and never appear.
//
// HOW A DOCUMENT IS CLASSIFIED
//   b2b            the buyer had a GSTIN on the document
//   b2c            the buyer had none
//   unclassified   the document has no place of supply, because the company had
//                  not enabled GST when it was written. Reported with a reason,
//                  never guessed into a table it does not belong in.
//
//   Every outward line lands in exactly one of those three, which is what makes
//   b2b + b2c + unclassified == all outward supplies, provably.
//
// CREDIT NOTES
//   A sales return is a credit note. It appears ONLY in cdnr/cdnur - never in
//   b2b or b2c - and always names the invoice it reverses. Its amounts are shown
//   positive (a credit note of 944 reads as 944) while the netting used by the
//   summaries subtracts it. That is why `sign` exists on a row.

const NOT_FILED =
  'GSTR-1 preparation dataset built from posted documents in this system. Not a filed return, not validated against the GST portal, and not a legal declaration.';

/** Loads the period's outward rows once. Everything below groups this set. */
async function loadOutwardRows(companyId, period) {
  const [invoiceLines, creditNoteLines] = await Promise.all([
    gstReturnRepository.findPeriodLines('SALES_INVOICE', companyId, period),
    gstReturnRepository.findPeriodLines('SALES_RETURN', companyId, period),
  ]);

  const invoiceConfig = gstReturnRepository.returnSourceConfig('SALES_INVOICE');
  const creditNoteConfig = gstReturnRepository.returnSourceConfig('SALES_RETURN');

  return {
    invoices: invoiceLines.map((row) => toReturnRow('SALES_INVOICE', invoiceConfig, row)),
    creditNotes: creditNoteLines.map((row) => toReturnRow('SALES_RETURN', creditNoteConfig, row)),
  };
}

// --- document-level tables -------------------------------------------------

/**
 * One entry per document, with its lines grouped by rate - the shape GSTR-1's
 * invoice tables take.
 */
function toDocumentEntries(rows, { includeOriginal = false } = {}) {
  const byDocument = groupRows(
    rows,
    (row) => row.documentId,
    (row) => row,
    // A credit-note table reads in positive amounts; the netting happens in the
    // summaries, not in the document listing.
    { applySign: false },
  );

  return byDocument.map((group) => {
    const head = group.meta;

    const byRate = groupRows(group.rows, rateKey, (row) => row, { applySign: false });

    return {
      documentId: head.documentId,
      documentNumber: head.documentNumber,
      documentDate: toBusinessDate(head.documentDate),
      documentValue: toMoneyString(head.documentValue, DISPLAY_DP),
      counterpartyGstin: head.counterpartyGstin,
      counterpartyName: head.partyName,
      supplyType: head.supplyType,
      placeOfSupply: withStateName(head.placeOfSupplyStateCode),
      ...(includeOriginal
        ? {
            originalInvoiceId: head.originalDocumentId,
            originalInvoiceNumber: head.originalDocumentNumber,
            originalInvoiceDate: toBusinessDate(head.originalDocumentDate),
          }
        : {}),
      items: byRate.map((rateGroup) => ({
        taxRate: rateGroup.key,
        taxTreatment: rateGroup.meta.taxTreatment,
        ...toPublicTotals(rateGroup.totals),
      })),
      ...toPublicTotals(group.totals),
    };
  });
}

/** Groups documents under their counterparty - GSTR-1's B2B table shape. */
function toPartyTable(rows, options) {
  const byParty = groupRows(rows, partyKey, (row) => row, { applySign: false });

  return byParty.map((group) => ({
    gstin: group.meta.counterpartyGstin,
    name: group.meta.partyName,
    documentCount: new Set(group.rows.map((row) => row.documentId)).size,
    documents: toDocumentEntries(group.rows, options),
    ...toPublicTotals(group.totals),
  }));
}

// --- summary tables --------------------------------------------------------

function toRateTable(rows, options) {
  return groupRows(rows, rateKey, (row) => row, options).map((group) => ({
    taxRate: group.key,
    documentCount: new Set(group.rows.map((row) => row.documentId)).size,
    ...toPublicTotals(group.totals),
  }));
}

function toHsnTable(rows, options) {
  return groupRows(rows, hsnKey, (row) => row, options).map((group) => ({
    hsn: group.meta.hsnCode,
    // Named so a null HSN is visibly a gap in the master data, not a code.
    isClassified: Boolean(group.meta.hsnCode),
    description: group.meta.productName,
    taxRate: rateKey(group.meta),
    ...toPublicTotals(group.totals),
  }));
}

function toPlaceOfSupplyTable(rows, options) {
  return groupRows(rows, placeOfSupplyKey, (row) => row, options).map((group) => ({
    ...withStateName(group.meta.placeOfSupplyStateCode),
    supplyType: group.meta.supplyType,
    documentCount: new Set(group.rows.map((row) => row.documentId)).size,
    ...toPublicTotals(group.totals),
  }));
}

// --- the dataset -----------------------------------------------------------

/**
 * @param {{ companyId: string }} currentUser
 * @param {{ fromDate: Date, toDate: Date }} period
 */
export async function buildGstr1(currentUser, period) {
  const { companyId } = currentUser;
  const { invoices, creditNotes } = await loadOutwardRows(companyId, period);

  const classify = (rows, category) =>
    rows.filter((row) => classifyRow(row).category === category);

  const b2bInvoices = classify(invoices, SUPPLY_CATEGORY.B2B);
  const b2cInvoices = classify(invoices, SUPPLY_CATEGORY.B2C);
  const unclassifiedInvoices = classify(invoices, SUPPLY_CATEGORY.UNCLASSIFIED);

  const b2bCreditNotes = classify(creditNotes, SUPPLY_CATEGORY.B2B);
  const b2cCreditNotes = classify(creditNotes, SUPPLY_CATEGORY.B2C);
  const unclassifiedCreditNotes = classify(creditNotes, SUPPLY_CATEGORY.UNCLASSIFIED);

  // Nil-rated, exempt and zero-rated lines. This is a VIEW over the same rows,
  // not a fourth bucket: the lines stay on their invoices, because removing a
  // line from an invoice would misrepresent a real document.
  const nilRatedRows = [...invoices, ...creditNotes].filter(isNilRatedOrExempt);

  const documentsIssued = await buildDocumentsIssued(companyId, period);

  const allOutward = [...invoices, ...creditNotes];

  return {
    period: {
      fromDate: toBusinessDate(period.fromDate),
      toDate: toBusinessDate(period.toDate),
      // Said explicitly so no caller has to guess whether the bounds are open.
      boundsInclusive: true,
      basis: 'Document business date (invoice date / credit note date)',
      includedStatuses: ['POSTED'],
      excludedStatuses: ['DRAFT', 'CANCELLED'],
    },

    // Table 4: supplies to registered persons.
    b2b: {
      description: 'Outward supplies to registered persons (buyer GSTIN present)',
      parties: toPartyTable(b2bInvoices),
      totals: toPublicTotals(sumRows(b2bInvoices, { applySign: false })),
    },

    // Tables 5 and 7: supplies to unregistered persons. The statutory split into
    // B2CL and B2CS depends on an invoice-value threshold that is a statutory
    // parameter this system does not store, so it is NOT applied here - both the
    // per-invoice detail and the state-and-rate summary are provided, which is
    // everything the split would need.
    b2c: {
      description: 'Outward supplies to unregistered persons (no buyer GSTIN)',
      note: 'The statutory B2CL / B2CS split by invoice value is not applied. See the limitations.',
      documents: toDocumentEntries(b2cInvoices),
      byPlaceOfSupplyAndRate: groupRows(
        b2cInvoices,
        (row) => `${placeOfSupplyKey(row)}|${rateKey(row)}`,
        (row) => row,
        { applySign: false },
      ).map((group) => ({
        ...withStateName(group.meta.placeOfSupplyStateCode),
        taxRate: rateKey(group.meta),
        ...toPublicTotals(group.totals),
      })),
      totals: toPublicTotals(sumRows(b2cInvoices, { applySign: false })),
    },

    // Table 9B: credit notes. Registered and unregistered, kept apart, each one
    // naming the invoice it reverses.
    creditNotes: {
      description: 'Credit notes issued against posted sales invoices (sales returns)',
      registered: {
        parties: toPartyTable(b2bCreditNotes, { includeOriginal: true }),
        totals: toPublicTotals(sumRows(b2bCreditNotes, { applySign: false })),
      },
      unregistered: {
        documents: toDocumentEntries(b2cCreditNotes, { includeOriginal: true }),
        totals: toPublicTotals(sumRows(b2cCreditNotes, { applySign: false })),
      },
      totals: toPublicTotals(sumRows(creditNotes, { applySign: false })),
    },

    // Table 8: nil-rated, exempted and zero-rated. A view, not a bucket.
    nilRatedExemptZeroRated: {
      description:
        'Lines whose tax treatment is EXEMPT, NIL_RATED or ZERO_RATED. These lines also appear on their own invoices above.',
      byTreatment: groupRows(
        nilRatedRows,
        (row) => row.taxTreatment ?? 'UNSPECIFIED',
        (row) => row,
      ).map((group) => ({
        taxTreatment: group.key,
        ...toPublicTotals(group.totals),
      })),
      totals: toPublicTotals(sumRows(nilRatedRows)),
    },

    // Table 12: HSN-wise summary of outward supplies, net of credit notes.
    hsnSummary: {
      description: 'HSN/SAC-wise outward supplies, net of credit notes',
      rows: toHsnTable(allOutward),
      totals: toPublicTotals(sumRows(allOutward)),
    },

    // Rate-wise outward tax, net of credit notes.
    rateSummary: {
      description: 'Rate-wise outward supplies, net of credit notes',
      rows: toRateTable(allOutward),
      totals: toPublicTotals(sumRows(allOutward)),
    },

    placeOfSupplySummary: {
      description: 'Place-of-supply-wise outward supplies, net of credit notes',
      rows: toPlaceOfSupplyTable(allOutward),
      totals: toPublicTotals(sumRows(allOutward)),
    },

    // Table 13: documents issued. Cancelled numbers are counted, because the
    // series consumed them.
    documentsIssued,

    // Anything that cannot lawfully be placed in a table above. Never guessed.
    unclassified: {
      description:
        'Posted documents with no place of supply, written before GST was enabled for this company. They cannot be placed in a GSTR-1 table and are listed here instead.',
      reason: 'NO_PLACE_OF_SUPPLY',
      invoices: toDocumentEntries(unclassifiedInvoices),
      creditNotes: toDocumentEntries(unclassifiedCreditNotes, { includeOriginal: true }),
      // Kept apart so that b2b + b2c + these invoices adds up to every posted
      // invoice in the period - which is what the reconciliation asserts.
      invoiceTotals: toPublicTotals(sumRows(unclassifiedInvoices, { applySign: false })),
      creditNoteTotals: toPublicTotals(sumRows(unclassifiedCreditNotes, { applySign: false })),
      totals: toPublicTotals(
        sumRows([...unclassifiedInvoices, ...unclassifiedCreditNotes], { applySign: false }),
      ),
    },

    // The whole period, net of credit notes: what every table above must add to.
    totals: {
      invoices: toPublicTotals(sumRows(invoices, { applySign: false })),
      creditNotes: toPublicTotals(sumRows(creditNotes, { applySign: false })),
      net: toPublicTotals(sumRows(allOutward)),
      invoiceCount: new Set(invoices.map((row) => row.documentId)).size,
      creditNoteCount: new Set(creditNotes.map((row) => row.documentId)).size,
    },

    notFiled: NOT_FILED,
  };
}

/** Table 13: the number series a period consumed, cancellations included. */
async function buildDocumentsIssued(companyId, period) {
  const [invoiceNumbers, creditNoteNumbers] = await Promise.all([
    gstReturnRepository.findIssuedDocumentNumbers('SALES_INVOICE', companyId, period),
    gstReturnRepository.findIssuedDocumentNumbers('SALES_RETURN', companyId, period),
  ]);

  const describe = (rows, field, label) => {
    const numbers = rows.map((row) => row[field]).sort((a, b) => a.localeCompare(b));
    const cancelled = rows.filter((row) => row.status === 'CANCELLED').length;

    return {
      documentType: label,
      from: numbers[0] ?? null,
      to: numbers[numbers.length - 1] ?? null,
      totalIssued: numbers.length,
      cancelled,
      net: numbers.length - cancelled,
    };
  };

  return {
    description: 'Document number series consumed in the period, including cancelled numbers',
    rows: [
      describe(invoiceNumbers, 'invoiceNumber', 'Tax invoice'),
      describe(creditNoteNumbers, 'returnNumber', 'Credit note'),
    ],
  };
}

export { NOT_FILED };
