import { describe, it, expect } from 'vitest';
import {
  calculateReturnLine,
  calculateReturnTotals,
  remainingReturnable,
} from '../../src/modules/sales-returns/sales-return.service.js';
import { deriveReceivableState } from '../../src/modules/customer-receivables/customer-receivable.service.js';

const line = (overrides = {}) => ({
  returnQuantity: '10',
  soldQuantity: '10',
  unitPrice: '120',
  originalDiscountAmount: '0',
  taxRate: null,
  ...overrides,
});

describe('remaining returnable quantity', () => {
  it('is the sold quantity when nothing has been returned', () => {
    expect(remainingReturnable('100', '0').toString()).toBe('100');
    expect(remainingReturnable('100', undefined).toString()).toBe('100');
  });

  it('subtracts what has already been returned', () => {
    expect(remainingReturnable('100', '30').toString()).toBe('70');
  });

  it('is zero once everything has been returned', () => {
    expect(remainingReturnable('100', '100').toString()).toBe('0');
  });

  it('never goes negative even if the data were inconsistent', () => {
    expect(remainingReturnable('100', '120').toString()).toBe('0');
  });

  it('handles fractional quantities exactly', () => {
    expect(remainingReturnable('0.3', '0.1').toString()).toBe('0.2');
  });
});

describe('sales return line calculation', () => {
  it('credits quantity times the original price', () => {
    const result = calculateReturnLine(line());

    expect(result.gross.toString()).toBe('1200');
    expect(result.taxableAmount.toString()).toBe('1200');
    expect(result.lineTotal.toString()).toBe('1200');
  });

  it('adds tax at the original rate', () => {
    const result = calculateReturnLine(line({ taxRate: '18' }));

    expect(result.taxAmount.toString()).toBe('216');
    expect(result.lineTotal.toString()).toBe('1416');
  });

  it('credits the whole discount back on a full return', () => {
    const result = calculateReturnLine(line({ originalDiscountAmount: '120', taxRate: '18' }));

    // Full return: the entire 120 discount is reversed.
    expect(result.discountAmount.toString()).toBe('120');
    expect(result.taxableAmount.toString()).toBe('1080');
    expect(result.taxAmount.toString()).toBe('194.4');
    expect(result.lineTotal.toString()).toBe('1274.4');
  });

  it('prorates the discount on a partial return', () => {
    // Returning 4 of 10 units carries 40% of the discount.
    const result = calculateReturnLine(
      line({ returnQuantity: '4', originalDiscountAmount: '120', taxRate: '18' }),
    );

    expect(result.gross.toString()).toBe('480');
    expect(result.discountAmount.toString()).toBe('48');
    expect(result.taxableAmount.toString()).toBe('432');
    expect(result.taxAmount.toString()).toBe('77.76');
    expect(result.lineTotal.toString()).toBe('509.76');
  });

  it('sums partial returns back to the full original credit', () => {
    const a = calculateReturnLine(line({ returnQuantity: '4', originalDiscountAmount: '120', taxRate: '18' }));
    const b = calculateReturnLine(line({ returnQuantity: '6', originalDiscountAmount: '120', taxRate: '18' }));
    const full = calculateReturnLine(line({ originalDiscountAmount: '120', taxRate: '18' }));

    expect(a.lineTotal.plus(b.lineTotal).toString()).toBe(full.lineTotal.toString());
  });

  it('treats a line with no tax as zero tax', () => {
    expect(calculateReturnLine(line()).taxAmount.toString()).toBe('0');
  });

  it('does not drift on values a float would corrupt', () => {
    const result = calculateReturnLine(line({ returnQuantity: '3', soldQuantity: '3', unitPrice: '0.1' }));
    expect(result.gross.toString()).toBe('0.3');
  });

  it('guards against a zero sold quantity rather than dividing by zero', () => {
    const result = calculateReturnLine(
      line({ returnQuantity: '0', soldQuantity: '0', originalDiscountAmount: '50' }),
    );
    expect(result.discountAmount.toString()).toBe('0');
  });
});

describe('sales return totals', () => {
  it('sums already-rounded line values', () => {
    const a = calculateReturnLine(line({ returnQuantity: '10', taxRate: '18' }));
    const b = calculateReturnLine(line({ returnQuantity: '5', soldQuantity: '5', unitPrice: '200', taxRate: '12' }));

    const totals = calculateReturnTotals([a, b]);

    expect(totals.subtotal.toString()).toBe('2200');
    expect(totals.taxTotal.toString()).toBe('336'); // 216 + 120
    expect(totals.grandTotal.toString()).toBe('2536');
    expect(totals.grandTotal.toString()).toBe(a.lineTotal.plus(b.lineTotal).toString());
  });

  it('returns zeroes for an empty line list', () => {
    expect(calculateReturnTotals([]).grandTotal.toString()).toBe('0');
  });
});

describe('receivable state with credits', () => {
  it('is OPEN when nothing is settled', () => {
    const result = deriveReceivableState({ originalAmount: '1000', creditAmount: '0', paidAmount: '0' });
    expect(result.outstandingAmount.toString()).toBe('1000');
    expect(result.status).toBe('OPEN');
  });

  it('is PARTIALLY_PAID when a return credits part of it', () => {
    const result = deriveReceivableState({ originalAmount: '1000', creditAmount: '200', paidAmount: '0' });
    expect(result.outstandingAmount.toString()).toBe('800');
    expect(result.status).toBe('PARTIALLY_PAID');
  });

  it('is CREDITED when returns settle it entirely and no money was paid', () => {
    const result = deriveReceivableState({ originalAmount: '1000', creditAmount: '1000', paidAmount: '0' });
    expect(result.outstandingAmount.toString()).toBe('0');
    expect(result.status).toBe('CREDITED');
  });

  it('is PAID when money settled it, even alongside a credit', () => {
    const result = deriveReceivableState({ originalAmount: '1000', creditAmount: '400', paidAmount: '600' });
    expect(result.outstandingAmount.toString()).toBe('0');
    expect(result.status).toBe('PAID');
  });

  it('never reports a negative outstanding when over-settled', () => {
    const result = deriveReceivableState({ originalAmount: '1000', creditAmount: '800', paidAmount: '400' });
    expect(result.outstandingAmount.toString()).toBe('0');
  });

  it('still works for callers that pass no credit at all', () => {
    const result = deriveReceivableState({ originalAmount: '1000', paidAmount: '250' });
    expect(result.outstandingAmount.toString()).toBe('750');
    expect(result.status).toBe('PARTIALLY_PAID');
  });
});
