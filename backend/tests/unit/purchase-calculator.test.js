import { describe, it, expect } from 'vitest';
import { calculateLine, calculateTotals } from '../../src/modules/purchases/purchase.calculator.js';

const line = (overrides = {}) => ({
  quantity: '10',
  unitCost: '100',
  discountType: 'NONE',
  discountValue: '0',
  taxRate: null,
  index: 0,
  ...overrides,
});

describe('purchase line calculation', () => {
  it('multiplies quantity by unit cost', () => {
    const result = calculateLine(line());

    expect(result.gross.toString()).toBe('1000');
    expect(result.discountAmount.toString()).toBe('0');
    expect(result.taxableAmount.toString()).toBe('1000');
    expect(result.lineTotal.toString()).toBe('1000');
  });

  it('applies a percentage discount before tax', () => {
    const result = calculateLine(line({ discountType: 'PERCENTAGE', discountValue: '5' }));

    expect(result.discountAmount.toString()).toBe('50');
    expect(result.taxableAmount.toString()).toBe('950');
  });

  it('applies a fixed discount to the whole line', () => {
    const result = calculateLine(line({ discountType: 'FIXED', discountValue: '75' }));

    expect(result.discountAmount.toString()).toBe('75');
    expect(result.taxableAmount.toString()).toBe('925');
  });

  it('calculates tax on the discounted amount, not the gross', () => {
    const result = calculateLine(
      line({ discountType: 'PERCENTAGE', discountValue: '5', taxRate: '18' }),
    );

    // 950 * 18% = 171, not 1000 * 18% = 180
    expect(result.taxAmount.toString()).toBe('171');
    expect(result.lineTotal.toString()).toBe('1121');
  });

  it('treats a line with no tax as zero tax', () => {
    const result = calculateLine(line({ taxRate: null }));
    expect(result.taxAmount.toString()).toBe('0');
  });

  it('rejects a percentage discount above 100', () => {
    expect(() => calculateLine(line({ discountType: 'PERCENTAGE', discountValue: '120' }))).toThrow(
      /greater than 100/,
    );
  });

  it('rejects a fixed discount larger than the line', () => {
    expect(() => calculateLine(line({ discountType: 'FIXED', discountValue: '2000' }))).toThrow(
      /greater than the line amount/,
    );
  });

  it('allows a fixed discount equal to the line amount', () => {
    const result = calculateLine(line({ discountType: 'FIXED', discountValue: '1000' }));

    expect(result.taxableAmount.toString()).toBe('0');
    expect(result.lineTotal.toString()).toBe('0');
  });

  it('does not drift on values a float would corrupt', () => {
    const result = calculateLine(line({ quantity: '3', unitCost: '0.1' }));
    // 3 * 0.1 is exactly 0.3, not 0.30000000000000004
    expect(result.gross.toString()).toBe('0.3');
  });

  it('handles fractional quantities and costs', () => {
    const result = calculateLine(line({ quantity: '2.5', unitCost: '19.99', taxRate: '12' }));

    expect(result.gross.toString()).toBe('49.975');
    expect(result.taxAmount.toString()).toBe('5.997');
    expect(result.lineTotal.toString()).toBe('55.972');
  });
});

describe('purchase totals', () => {
  it('sums the already-rounded line values so lines match the total', () => {
    const a = calculateLine(line({ quantity: '100', unitCost: '10', discountType: 'PERCENTAGE', discountValue: '5', taxRate: '18' }));
    const b = calculateLine(line({ quantity: '50', unitCost: '20', taxRate: '12', index: 1 }));

    const totals = calculateTotals([a, b]);

    expect(totals.subtotal.toString()).toBe('2000'); // 1000 + 1000
    expect(totals.discountTotal.toString()).toBe('50');
    expect(totals.taxTotal.toString()).toBe('291'); // 171 + 120
    expect(totals.grandTotal.toString()).toBe('2241'); // 1121 + 1120

    // The invariant that makes a printed invoice add up.
    expect(totals.grandTotal.toString()).toBe(a.lineTotal.plus(b.lineTotal).toString());
  });

  it('returns zeroes for an empty line list', () => {
    const totals = calculateTotals([]);
    expect(totals.grandTotal.toString()).toBe('0');
  });
});
