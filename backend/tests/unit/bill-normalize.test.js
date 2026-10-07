import { describe, it, expect } from 'vitest';
import {
  normalizeDate,
  normalizeGstin,
  normalizeHsn,
  normalizePhone,
  normalizeLine,
  normalizeInvoice,
  parseQuantityText,
  toNumberText,
} from '../../src/modules/bills/bill-normalize.js';

// Shapes taken from the sample bills in /asstes: retail bills with tax only in
// the totals box, quantities with units, masked phones, demo GSTINs, and a PDF
// holding three separate invoices.

describe('bill-normalize: single values', () => {
  it('reads money with rupee signs, boxes and separators', () => {
    expect(toNumberText('■ 2,052.76')).toBe('2052.76');
    expect(toNumberText('₹1,00,000')).toBe('100000');
    expect(toNumberText('')).toBeNull();
  });

  it('keeps only real GSTINs', () => {
    expect(normalizeGstin('DEMO-GSTIN-NOT-VALID')).toBeNull();
    expect(normalizeGstin('27aapfu0939f1zv')).toBe('27AAPFU0939F1ZV');
  });

  it('drops masked phones', () => {
    expect(normalizePhone('98XXXXXXXX')).toBeNull();
    expect(normalizePhone('+91 98300 12345')).not.toBeNull();
  });

  it('reads Indian dates day first', () => {
    expect(normalizeDate('06-Oct-2026')).toBe('2026-10-06');
    expect(normalizeDate('03/04/2025')).toBe('2025-04-03');
    expect(normalizeDate('2026-10-06')).toBe('2026-10-06');
    expect(normalizeDate('October 6, 2026')).toBe('2026-10-06');
  });

  it('keeps HSN leading zeros', () => {
    expect(normalizeHsn('0713')).toBe('0713');
    expect(normalizeHsn('713')).toBe('0713');
    expect(normalizeHsn('9983')).toBe('9983');
  });

  it('splits a quantity cell into number and unit', () => {
    expect(parseQuantityText('500 g')).toEqual({ quantity: 500, unit: 'g' });
    expect(parseQuantityText('2 Kg')).toEqual({ quantity: 2, unit: 'kg' });
    expect(parseQuantityText('4 pcs')).toEqual({ quantity: 4, unit: 'pcs' });
  });
});

describe('bill-normalize: lines', () => {
  it('500 g at a per-kg rate becomes 0.5 kg', () => {
    const { line, warnings } = normalizeLine({ description: 'Kaju Barfi', quantityText: '500 g', unitPrice: '650', lineTotal: '325' });
    expect(line.quantity).toBe('0.5');
    expect(line.unit).toBe('kg');
    expect(warnings.length).toBe(1);
  });

  it('a plain line stays as printed', () => {
    const { line, warnings } = normalizeLine({ description: 'Rice', hsnCode: '1006', quantityText: '2 Kg', unitPrice: '240', lineTotal: '480' });
    expect(line).toMatchObject({ quantity: '2', unit: 'kg', unitPrice: '240.00', lineTotal: '480.00', hsnCode: '1006' });
    expect(warnings).toEqual([]);
  });

  it('a pack size in the item name is not the selling unit', () => {
    const tea = normalizeLine({ description: 'Red Label Tea 250 g', quantityText: '1', unit: 'g', unitPrice: '145', lineTotal: '145' });
    expect(tea.line).toMatchObject({ quantity: '1', unit: null });
    const sweet = normalizeLine({ description: 'Rasgulla', quantityText: '2 Kg', unit: 'kg', unitPrice: '240', lineTotal: '480' });
    expect(sweet.line.unit).toBe('kg');
  });

  it('a batch number is kept apart from the HSN', () => {
    const { line } = normalizeLine({ description: 'Syrup', hsnCode: '2106', batch: 'HB2408', quantityText: '1', unitPrice: '399', lineTotal: '399' });
    expect(line.batch).toBe('HB2408');
    expect(line.hsnCode).toBe('2106');
  });

  it('flags a line that does not add up', () => {
    const { warnings } = normalizeLine({ description: 'X', quantityText: '3', unitPrice: '7', lineTotal: '10' });
    expect(warnings[0]).toMatch(/please check/);
  });
});

describe('bill-normalize: invoice', () => {
  const sweetShop = {
    sellerName: 'Ananda Mistanna Bhandar',
    sellerGstin: 'DEMO-GSTIN-NOT-VALID',
    sellerPhone: '98XXXXXXXX',
    buyerName: 'Walk-in Customer',
    invoiceNumber: 'AMB-2026-0318',
    invoiceDate: '06-Oct-2026',
    paymentMode: 'Cash/UPI',
    subtotal: '2,415.00',
    taxLines: [
      { label: 'CGST', rate: '2.5', amount: '60.38' },
      { label: 'SGST', rate: '2.5', amount: '60.38' },
    ],
    grandTotal: '2,535.76',
    lines: [
      { description: 'Rasgulla', hsnCode: '2106', quantityText: '2 Kg', unitPrice: '240', lineTotal: '480' },
      { description: 'Kaju Barfi', hsnCode: '2106', quantityText: '500 g', unitPrice: '650', lineTotal: '325' },
      { description: 'Mishti Doi', hsnCode: '403', quantityText: '4 pcs', unitPrice: '55', lineTotal: '220' },
      { description: 'Rest', hsnCode: '2106', quantityText: '1', unitPrice: '1390', lineTotal: '1390' },
    ],
  };

  it('a received bill takes the seller as the party', () => {
    const out = normalizeInvoice(sweetShop, 'IN');
    expect(out.partyName).toBe('Ananda Mistanna Bhandar');
    expect(out.partyGstin).toBeNull();
    expect(out.partyPhone).toBeNull();
    expect(out.warnings.some((w) => /not a valid GSTIN/.test(w))).toBe(true);
  });

  it('an issued bill takes the buyer as the party', () => {
    expect(normalizeInvoice(sweetShop, 'OUT').partyName).toBe('Walk-in Customer');
  });

  it('spreads the bill-level tax rate onto the lines and adds up', () => {
    const out = normalizeInvoice(sweetShop, 'OUT');
    expect(out.lines.every((l) => l.taxRate === '5')).toBe(true);
    expect(out.totalTax).toBe('120.76');
    expect(out.lines[1].quantity).toBe('0.5');
    expect(out.lines[2].hsnCode).toBe('0403');
    expect(out.warnings.some((w) => /please check|misread/.test(w))).toBe(false);
  });

  it('"Payment: Cash/UPI" means paid in full', () => {
    const out = normalizeInvoice(sweetShop, 'OUT');
    expect(out.amountPaid).toBe('2535.76');
    expect(out.invoiceDate).toBe('2026-10-06');
  });

  it('credit is not paid', () => {
    expect(normalizeInvoice({ ...sweetShop, paymentMode: 'Credit' }, 'OUT').amountPaid).toBeNull();
  });

  it('IGST is the rate, not doubled', () => {
    const out = normalizeInvoice(
      { ...sweetShop, taxLines: [{ label: 'IGST', rate: '18', amount: '434.70' }], grandTotal: '2849.70' },
      'OUT',
    );
    expect(out.lines[0].taxRate).toBe('18');
  });

  it('warns when the total does not match', () => {
    const out = normalizeInvoice({ ...sweetShop, grandTotal: '9999' }, 'OUT');
    expect(out.warnings.some((w) => /total printed/.test(w))).toBe(true);
  });
});
