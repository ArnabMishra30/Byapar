import { describe, it, expect } from 'vitest';
import {
  calculateReturnLine,
  calculateLineTotal,
  remainingReturnable,
} from '../../src/modules/purchase-returns/purchase-return.service.js';

// Regression coverage for QA finding H1: a purchase return must hand back a
// PRO-RATA share of the original purchase line's discount, so the supplier
// credit and the input-tax reversal are computed on the net (discounted)
// taxable amount, never on the gross cost.

const line = (overrides = {}) => ({
  returnQuantity: '10',
  purchasedQuantity: '10',
  unitCost: '100',
  originalDiscountAmount: '0',
  ...overrides,
});

describe('remaining returnable quantity', () => {
  it('is the purchased quantity when nothing has been returned', () => {
    expect(remainingReturnable('100', '0').toString()).toBe('100');
    expect(remainingReturnable('100', undefined).toString()).toBe('100');
  });

  it('subtracts what has already been returned', () => {
    expect(remainingReturnable('100', '40').toString()).toBe('60');
  });

  it('never goes negative even if the data were inconsistent', () => {
    expect(remainingReturnable('100', '130').toString()).toBe('0');
  });
});

describe('purchase return line calculation (H1)', () => {
  it('equals gross when the original line carried no discount', () => {
    const result = calculateReturnLine(line());
    expect(result.gross.toString()).toBe('1000');
    expect(result.discountAmount.toString()).toBe('0');
    expect(result.taxableAmount.toString()).toBe('1000');
  });

  it('reverses the WHOLE discount on a full return', () => {
    // Original line: 10 @ 100 = 1000 gross, 100 discount -> 900 taxable.
    const result = calculateReturnLine(line({ originalDiscountAmount: '100' }));
    expect(result.gross.toString()).toBe('1000');
    expect(result.discountAmount.toString()).toBe('100');
    expect(result.taxableAmount.toString()).toBe('900');
  });

  it('prorates the discount on a partial return', () => {
    // Returning 4 of 10 units carries 40% of the 100 discount = 40.
    const result = calculateReturnLine(
      line({ returnQuantity: '4', originalDiscountAmount: '100' }),
    );
    expect(result.gross.toString()).toBe('400');
    expect(result.discountAmount.toString()).toBe('40');
    expect(result.taxableAmount.toString()).toBe('360');
  });

  it('sums partial returns back to the full discounted credit', () => {
    const a = calculateReturnLine(line({ returnQuantity: '4', originalDiscountAmount: '100' }));
    const b = calculateReturnLine(line({ returnQuantity: '6', originalDiscountAmount: '100' }));
    const full = calculateReturnLine(line({ originalDiscountAmount: '100' }));
    expect(a.taxableAmount.plus(b.taxableAmount).toString()).toBe(full.taxableAmount.toString());
  });

  it('does not drift on values a float would corrupt', () => {
    const result = calculateReturnLine(
      line({ returnQuantity: '3', purchasedQuantity: '3', unitCost: '0.1' }),
    );
    expect(result.gross.toString()).toBe('0.3');
  });

  it('guards against a zero purchased quantity rather than dividing by zero', () => {
    const result = calculateReturnLine(
      line({ returnQuantity: '0', purchasedQuantity: '0', originalDiscountAmount: '50' }),
    );
    expect(result.discountAmount.toString()).toBe('0');
    expect(result.taxableAmount.toString()).toBe('0');
  });

  it('still exposes the gross-only helper for callers that want it', () => {
    expect(calculateLineTotal('10', '100').toString()).toBe('1000');
  });
});
