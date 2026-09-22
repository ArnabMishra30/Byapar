import { describe, it, expect } from 'vitest';
import {
  classifyRow,
  isNilRatedOrExempt,
  emptyTotals,
  addRow,
  sumRows,
  addTotals,
  subtractTotals,
  toPublicTotals,
  componentDifference,
  groupRows,
  rateKey,
  hsnKey,
  placeOfSupplyKey,
  partyKey,
  toBusinessDate,
  withStateName,
  toReturnRow,
  SUPPLY_CATEGORY,
  UNCLASSIFIED_REASON,
} from '../../src/modules/tax/gst-return.dataset.js';

// The grouping engine behind both return datasets, tested without a database.
//
// The assertion that recurs here is that a grouping ADDS BACK UP. Every table in
// a GST return is a different view of one set of rows, and if any view loses a
// paisa the return is wrong in a way that is very hard to spot later.

/** A row in the shape `toReturnRow` produces. */
function row(overrides = {}) {
  return {
    source: 'SALES_INVOICE',
    direction: 'OUTWARD',
    sign: 1,
    documentId: 'doc-1',
    documentNumber: 'INV-2026-000001',
    documentDate: new Date('2026-09-01T00:00:00.000Z'),
    documentValue: '1180',
    originalDocumentId: null,
    originalDocumentNumber: null,
    originalDocumentDate: null,
    partyName: 'Ravi Medicals',
    counterpartyGstin: '27AAPFU0939F1ZV',
    ownGstin: '27AAACC1206D1ZM',
    supplyType: 'INTRA_STATE',
    placeOfSupplyStateCode: '27',
    lineId: 'line-1',
    productName: 'Paracetamol',
    hsnCode: '30049011',
    taxTreatment: 'TAXABLE',
    taxRate: '18.00',
    taxableAmount: '1000',
    cgstAmount: '90',
    sgstAmount: '90',
    igstAmount: '0',
    cessAmount: '0',
    taxAmount: '180',
    ...overrides,
  };
}

const creditNote = (overrides = {}) =>
  row({ source: 'SALES_RETURN', sign: -1, documentId: 'cn-1', documentNumber: 'SR-1', ...overrides });

describe('classifying an outward supply', () => {
  it('is B2B when the buyer had a GSTIN on the document', () => {
    const result = classifyRow(row());
    expect(result.category).toBe(SUPPLY_CATEGORY.B2B);
    expect(result.reason).toBeNull();
  });

  it('is B2C when the buyer had none', () => {
    const result = classifyRow(row({ counterpartyGstin: null }));
    expect(result.category).toBe(SUPPLY_CATEGORY.B2C);
  });

  it('is UNCLASSIFIED with a reason when there is no place of supply', () => {
    // A document written before GST was enabled. There is no lawful table for
    // it, so it is named rather than guessed into B2C.
    const result = classifyRow(row({ supplyType: null, placeOfSupplyStateCode: null }));
    expect(result.category).toBe(SUPPLY_CATEGORY.UNCLASSIFIED);
    expect(result.reason).toBe(UNCLASSIFIED_REASON.NO_PLACE_OF_SUPPLY);
  });

  it('is UNCLASSIFIED even when a GSTIN happens to be present', () => {
    // Having the buyer's GSTIN does not make a supply placeable: the place of
    // supply is what decides which table and which tax it belongs to.
    const result = classifyRow(row({ supplyType: null, placeOfSupplyStateCode: null }));
    expect(result.category).toBe(SUPPLY_CATEGORY.UNCLASSIFIED);
  });

  it('separates nil-rated and exempt from taxable by treatment, not by rate', () => {
    expect(isNilRatedOrExempt(row({ taxTreatment: 'TAXABLE', taxRate: '0.00' }))).toBe(false);
    expect(isNilRatedOrExempt(row({ taxTreatment: 'EXEMPT' }))).toBe(true);
    expect(isNilRatedOrExempt(row({ taxTreatment: 'NIL_RATED' }))).toBe(true);
    expect(isNilRatedOrExempt(row({ taxTreatment: 'ZERO_RATED' }))).toBe(true);
    // A line with no tax chosen at all is untaxed, which is not exempt.
    expect(isNilRatedOrExempt(row({ taxTreatment: null }))).toBe(false);
  });
});

describe('totalling rows', () => {
  it('starts at zero', () => {
    expect(toPublicTotals(emptyTotals())).toEqual({
      taxableAmount: '0.00',
      cgst: '0.00',
      sgst: '0.00',
      igst: '0.00',
      cess: '0.00',
      totalTax: '0.00',
    });
  });

  it('adds an invoice', () => {
    const totals = sumRows([row()]);
    expect(totals.taxableAmount.toString()).toBe('1000');
    expect(totals.cgst.toString()).toBe('90');
    expect(totals.tax.toString()).toBe('180');
  });

  it('SUBTRACTS a credit note, so an invoice and its reversal net to zero', () => {
    const totals = sumRows([row(), creditNote()]);

    expect(totals.taxableAmount.toString()).toBe('0');
    expect(totals.cgst.toString()).toBe('0');
    expect(totals.tax.toString()).toBe('0');
  });

  it('reports a credit-note table in positive amounts when asked', () => {
    // A credit note of 180 should read as 180 in its own table; the netting is
    // the summaries' job, not the listing's.
    const totals = sumRows([creditNote()], { applySign: false });
    expect(totals.tax.toString()).toBe('180');
  });

  it('adds and subtracts whole totals', () => {
    const a = sumRows([row()]);
    const b = sumRows([row()]);

    expect(addTotals(a, b).tax.toString()).toBe('360');
    expect(subtractTotals(a, b).tax.toString()).toBe('0');
  });

  it('uses Decimal, never floating point', () => {
    const totals = sumRows([
      row({ taxableAmount: '0.1', cgstAmount: '0.1', sgstAmount: '0', taxAmount: '0.1' }),
      row({ taxableAmount: '0.2', cgstAmount: '0.2', sgstAmount: '0', taxAmount: '0.2' }),
    ]);

    expect(totals.taxableAmount.toString()).toBe('0.3');
    expect(totals.cgst.toString()).toBe('0.3');
  });

  it('keeps four decimal places through the sum and rounds once at the edge', () => {
    const totals = sumRows([
      row({ cgstAmount: '30.0002', sgstAmount: '30.0002', taxAmount: '60.0004' }),
    ]);

    expect(totals.tax.toString()).toBe('60.0004');
    expect(toPublicTotals(totals).totalTax).toBe('60.00');
  });
});

describe('the component identity', () => {
  it('is satisfied by a well-formed intra-state row', () => {
    expect(componentDifference(sumRows([row()])).toString()).toBe('0');
  });

  it('is satisfied by an inter-state row', () => {
    const totals = sumRows([
      row({ cgstAmount: '0', sgstAmount: '0', igstAmount: '180', supplyType: 'INTER_STATE' }),
    ]);
    expect(componentDifference(totals).toString()).toBe('0');
  });

  it('includes cess', () => {
    const totals = sumRows([row({ cessAmount: '120', taxAmount: '300' })]);
    expect(componentDifference(totals).toString()).toBe('0');
  });

  it('reports the gap rather than hiding it when the split does not add up', () => {
    const totals = sumRows([row({ taxAmount: '200' })]);
    expect(componentDifference(totals).toString()).toBe('-20');
  });
});

describe('grouping', () => {
  const mixed = [
    row({ lineId: 'a', taxRate: '5.00', hsnCode: '3001', taxableAmount: '1000', cgstAmount: '25', sgstAmount: '25', taxAmount: '50' }),
    row({ lineId: 'b', taxRate: '12.00', hsnCode: '3002', taxableAmount: '1000', cgstAmount: '60', sgstAmount: '60', taxAmount: '120' }),
    row({ lineId: 'c', taxRate: '18.00', hsnCode: '3001', taxableAmount: '1000', cgstAmount: '90', sgstAmount: '90', taxAmount: '180' }),
  ];

  it('groups by rate and adds back up to the ungrouped total', () => {
    const grouped = groupRows(mixed, rateKey);
    const regrouped = grouped.reduce((totals, group) => addTotals(totals, group.totals), emptyTotals());

    expect(grouped.map((group) => group.key)).toEqual(['12.00', '18.00', '5.00']);
    expect(regrouped.tax.toString()).toBe(sumRows(mixed).tax.toString());
  });

  it('groups by HSN and adds back up', () => {
    const grouped = groupRows(mixed, hsnKey);
    const regrouped = grouped.reduce((totals, group) => addTotals(totals, group.totals), emptyTotals());

    expect(grouped.map((group) => group.key)).toEqual(['3001', '3002']);
    expect(regrouped.taxableAmount.toString()).toBe('3000');
    expect(regrouped.tax.toString()).toBe('350');
  });

  it('groups by place of supply and adds back up', () => {
    const rows = [row(), row({ lineId: 'x', placeOfSupplyStateCode: '29', supplyType: 'INTER_STATE' })];
    const grouped = groupRows(rows, placeOfSupplyKey);

    expect(grouped.map((group) => group.key)).toEqual(['27', '29']);
    expect(
      grouped.reduce((totals, group) => addTotals(totals, group.totals), emptyTotals()).tax.toString(),
    ).toBe('360');
  });

  it('groups by party, falling back to the name when there is no GSTIN', () => {
    const rows = [
      row(),
      row({ lineId: 'y', counterpartyGstin: null, partyName: 'Walk-in Customer' }),
    ];
    const grouped = groupRows(rows, partyKey);

    expect(grouped.map((group) => group.key)).toEqual([
      '27AAPFU0939F1ZV',
      'NAME:Walk-in Customer',
    ]);
  });

  it('is deterministic: the same rows in any order produce the same result', () => {
    const forwards = groupRows(mixed, rateKey);
    const backwards = groupRows([...mixed].reverse(), rateKey);

    expect(backwards.map((group) => group.key)).toEqual(forwards.map((group) => group.key));
    expect(backwards.map((group) => group.totals.tax.toString())).toEqual(
      forwards.map((group) => group.totals.tax.toString()),
    );
  });

  it('keeps two documents with identical amounts separate', () => {
    // A grouping keyed on the amount would silently merge these. Keyed on the
    // document id, they stay two documents.
    const rows = [
      row({ documentId: 'doc-1', lineId: 'l1' }),
      row({ documentId: 'doc-2', documentNumber: 'INV-2026-000002', lineId: 'l2' }),
    ];
    const grouped = groupRows(rows, (entry) => entry.documentId);

    expect(grouped).toHaveLength(2);
    expect(sumRows(rows).tax.toString()).toBe('360');
  });

  it('names an unrated line and an unclassified HSN rather than dropping them', () => {
    const rows = [row({ taxRate: null, hsnCode: null })];

    expect(groupRows(rows, rateKey)[0].key).toBe('UNRATED');
    expect(groupRows(rows, hsnKey)[0].key).toBe('UNCLASSIFIED');
    expect(groupRows(rows, placeOfSupplyKey)[0].key).toBe('27');
    expect(groupRows([row({ placeOfSupplyStateCode: null })], placeOfSupplyKey)[0].key).toBe(
      'UNKNOWN',
    );
  });

  it('nets a credit note out of its group', () => {
    const grouped = groupRows([row(), creditNote()], rateKey);

    expect(grouped).toHaveLength(1);
    expect(grouped[0].totals.tax.toString()).toBe('0');
  });

  it('returns nothing for no rows', () => {
    expect(groupRows([], rateKey)).toEqual([]);
    expect(sumRows([]).tax.toString()).toBe('0');
  });
});

describe('normalising a database row', () => {
  const config = {
    relation: 'salesInvoice',
    dateField: 'invoiceDate',
    numberField: 'invoiceNumber',
    taxableField: 'taxableAmount',
    direction: 'OUTWARD',
    sign: 1,
  };

  const dbRow = {
    id: 'line-9',
    productNameSnapshot: 'Paracetamol',
    hsnCodeSnapshot: '30049011',
    taxTreatmentSnapshot: 'TAXABLE',
    taxRateSnapshot: '18.00',
    taxableAmount: '1000',
    cgstAmount: '90',
    sgstAmount: '90',
    igstAmount: '0',
    cessAmount: '0',
    taxAmount: '180',
    salesInvoice: {
      id: 'inv-9',
      invoiceNumber: 'INV-2026-000009',
      invoiceDate: new Date('2026-09-15T00:00:00.000Z'),
      customerNameSnapshot: 'Ravi Medicals',
      buyerGstin: '27AAPFU0939F1ZV',
      sellerGstin: '27AAACC1206D1ZM',
      supplyType: 'INTRA_STATE',
      placeOfSupplyStateCode: '27',
      grandTotal: '1180',
    },
  };

  it('flattens the header and the line into one row', () => {
    const result = toReturnRow('SALES_INVOICE', config, dbRow);

    expect(result.documentNumber).toBe('INV-2026-000009');
    expect(result.partyName).toBe('Ravi Medicals');
    // Outward: the counterparty is the buyer.
    expect(result.counterpartyGstin).toBe('27AAPFU0939F1ZV');
    expect(result.ownGstin).toBe('27AAACC1206D1ZM');
    expect(result.hsnCode).toBe('30049011');
    expect(result.taxableAmount).toBe('1000');
  });

  it('takes the counterparty from the other side for an inward supply', () => {
    const inward = { ...config, direction: 'INWARD' };
    const result = toReturnRow('PURCHASE', inward, dbRow);

    expect(result.counterpartyGstin).toBe('27AAACC1206D1ZM');
    expect(result.ownGstin).toBe('27AAPFU0939F1ZV');
  });

  it('carries the original invoice reference on a credit note', () => {
    const creditConfig = {
      ...config,
      relation: 'salesReturn',
      dateField: 'returnDate',
      numberField: 'returnNumber',
      sign: -1,
    };
    const creditRow = {
      ...dbRow,
      salesReturn: {
        ...dbRow.salesInvoice,
        returnNumber: 'SR-2026-000001',
        returnDate: new Date('2026-09-20T00:00:00.000Z'),
        salesInvoice: {
          id: 'inv-9',
          invoiceNumber: 'INV-2026-000009',
          invoiceDate: new Date('2026-09-15T00:00:00.000Z'),
        },
      },
    };

    const result = toReturnRow('SALES_RETURN', creditConfig, creditRow);

    expect(result.documentNumber).toBe('SR-2026-000001');
    expect(result.originalDocumentNumber).toBe('INV-2026-000009');
    expect(toBusinessDate(result.originalDocumentDate)).toBe('2026-09-15');
    expect(result.sign).toBe(-1);
  });
});

describe('serialisation helpers', () => {
  it('renders a business date without a timezone shift', () => {
    expect(toBusinessDate(new Date('2026-09-01T00:00:00.000Z'))).toBe('2026-09-01');
    expect(toBusinessDate(null)).toBeNull();
  });

  it('names a state code', () => {
    expect(withStateName('27')).toEqual({ stateCode: '27', stateName: 'Maharashtra' });
    expect(withStateName(null)).toEqual({ stateCode: null, stateName: null });
  });
});
