import { describe, it, expect } from 'vitest';
import {
  calculateSalesLine,
  calculateSalesTotals,
  calculateCogs,
  calculateGrossMargin,
} from '../../src/modules/sales/sales.calculator.js';

const line = (overrides = {}) => ({
  quantity: '10',
  unitPrice: '120',
  discountType: 'NONE',
  discountValue: '0',
  taxRate: null,
  index: 0,
  ...overrides,
});

describe('sales line calculation', () => {
  it('multiplies quantity by unit price', () => {
    const result = calculateSalesLine(line());

    expect(result.gross.toString()).toBe('1200');
    expect(result.taxableAmount.toString()).toBe('1200');
    expect(result.lineTotal.toString()).toBe('1200');
  });

  it('applies a percentage discount before tax', () => {
    const result = calculateSalesLine(line({ discountType: 'PERCENTAGE', discountValue: '10' }));

    expect(result.discountAmount.toString()).toBe('120');
    expect(result.taxableAmount.toString()).toBe('1080');
  });

  it('applies a fixed discount to the whole line', () => {
    const result = calculateSalesLine(line({ discountType: 'FIXED', discountValue: '200' }));

    expect(result.discountAmount.toString()).toBe('200');
    expect(result.taxableAmount.toString()).toBe('1000');
  });

  it('calculates tax on the discounted amount, not the gross', () => {
    const result = calculateSalesLine(
      line({ discountType: 'PERCENTAGE', discountValue: '10', taxRate: '18' }),
    );

    // 1080 * 18% = 194.40, not 1200 * 18% = 216
    expect(result.taxAmount.toString()).toBe('194.4');
    expect(result.lineTotal.toString()).toBe('1274.4');
  });

  it('treats a line with no tax as zero tax', () => {
    expect(calculateSalesLine(line()).taxAmount.toString()).toBe('0');
  });

  it('rejects a percentage discount above 100', () => {
    expect(() =>
      calculateSalesLine(line({ discountType: 'PERCENTAGE', discountValue: '150' })),
    ).toThrow(/greater than 100/);
  });

  it('rejects a fixed discount larger than the line', () => {
    expect(() => calculateSalesLine(line({ discountType: 'FIXED', discountValue: '5000' }))).toThrow(
      /greater than the line amount/,
    );
  });

  it('does not drift on values a float would corrupt', () => {
    const result = calculateSalesLine(line({ quantity: '3', unitPrice: '0.1' }));
    // 3 * 0.1 is exactly 0.3, not 0.30000000000000004
    expect(result.gross.toString()).toBe('0.3');
  });

  it('handles fractional quantities and prices', () => {
    const result = calculateSalesLine(line({ quantity: '2.5', unitPrice: '19.99', taxRate: '12' }));

    expect(result.gross.toString()).toBe('49.975');
    expect(result.taxAmount.toString()).toBe('5.997');
    expect(result.lineTotal.toString()).toBe('55.972');
  });
});

describe('sales invoice totals', () => {
  it('sums already-rounded line values so lines match the total', () => {
    const a = calculateSalesLine(
      line({ quantity: '10', unitPrice: '120', discountType: 'PERCENTAGE', discountValue: '10', taxRate: '18' }),
    );
    const b = calculateSalesLine(line({ quantity: '5', unitPrice: '200', taxRate: '12', index: 1 }));

    const totals = calculateSalesTotals([a, b]);

    expect(totals.subtotal.toString()).toBe('2200'); // 1200 + 1000
    expect(totals.discountTotal.toString()).toBe('120');
    expect(totals.taxTotal.toString()).toBe('314.4'); // 194.40 + 120
    expect(totals.grandTotal.toString()).toBe('2394.4');

    // The invariant that makes a printed invoice add up.
    expect(totals.grandTotal.toString()).toBe(a.lineTotal.plus(b.lineTotal).toString());
  });

  it('returns zeroes for an empty line list', () => {
    expect(calculateSalesTotals([]).grandTotal.toString()).toBe('0');
  });
});

describe('COGS', () => {
  it('multiplies quantity by the cost the stock actually left at', () => {
    const result = calculateCogs('10', '80');

    expect(result.cogsUnitCost.toString()).toBe('80');
    expect(result.cogsAmount.toString()).toBe('800');
  });

  it('keeps a fractional average cost exact', () => {
    const result = calculateCogs('3', '11.3333');

    expect(result.cogsAmount.toString()).toBe('33.9999');
  });

  it('computes gross margin as revenue net of tax minus cost', () => {
    // Sold 10 @ 120 = 1200 taxable; cost 10 @ 80 = 800.
    expect(calculateGrossMargin('1200', '800').toString()).toBe('400');
  });

  it('reports a negative margin when goods are sold below cost', () => {
    expect(calculateGrossMargin('500', '800').toString()).toBe('-300');
  });
});
