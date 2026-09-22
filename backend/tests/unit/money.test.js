import { describe, it, expect } from 'vitest';
import { add, subtract, multiply, round, toMoneyString } from '../../src/utils/money.js';

describe('money helpers', () => {
  it('adds without floating point error', () => {
    // 0.1 + 0.2 === 0.30000000000000004 with normal JavaScript numbers
    expect(add(0.1, 0.2).toString()).toBe('0.3');
  });

  it('subtracts without floating point error', () => {
    expect(subtract(1.0, 0.9).toString()).toBe('0.1');
  });

  it('multiplies quantity by rate exactly', () => {
    expect(multiply('3', '19.99').toString()).toBe('59.97');
  });

  it('rounds half away from zero', () => {
    expect(round('2.005').toString()).toBe('2.01');
    expect(round('2.004').toString()).toBe('2');
  });

  it('formats money with a fixed number of decimals', () => {
    expect(toMoneyString('1234.5')).toBe('1234.50');
    expect(toMoneyString(0)).toBe('0.00');
  });

  it('treats null and undefined as zero', () => {
    expect(add(null, undefined).toString()).toBe('0');
  });
});
