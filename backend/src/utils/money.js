import { Prisma } from '@prisma/client';

// Money must never go through normal JavaScript number arithmetic:
//   0.1 + 0.2 === 0.30000000000000004
// Every future module (GST, pricing, invoices, accounting) must use these helpers
// and store money columns as Prisma Decimal, never Float.

const Decimal = Prisma.Decimal;

/** @param {string|number|Prisma.Decimal} value */
export function toDecimal(value) {
  return new Decimal(value ?? 0);
}

export function add(a, b) {
  return toDecimal(a).plus(toDecimal(b));
}

export function subtract(a, b) {
  return toDecimal(a).minus(toDecimal(b));
}

export function multiply(a, b) {
  return toDecimal(a).times(toDecimal(b));
}

/**
 * Round to `dp` decimal places, half away from zero (2.005 -> 2.01).
 * This is the rounding rule for all money values in this project.
 */
export function round(value, dp = 2) {
  return toDecimal(value).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP);
}

/** Money as a string for API responses, e.g. "1234.50". Never send Decimal objects. */
export function toMoneyString(value, dp = 2) {
  return round(value, dp).toFixed(dp);
}

/**
 * Divide with full Decimal precision. Never rounds here - round at the boundary
 * where the value is stored or serialized, not in the middle of a calculation.
 *
 * Throws on division by zero: a caller dividing by zero has a logic error, and
 * silently returning 0 would corrupt an average cost.
 */
export function divide(a, b) {
  const divisor = toDecimal(b);
  if (divisor.isZero()) {
    throw new Error('Division by zero in a money calculation');
  }
  return toDecimal(a).dividedBy(divisor);
}

/** True when a is greater than b. Used instead of comparing Numbers. */
export function isGreaterThan(a, b) {
  return toDecimal(a).greaterThan(toDecimal(b));
}

/** True when a is less than b. */
export function isLessThan(a, b) {
  return toDecimal(a).lessThan(toDecimal(b));
}

export function isZero(value) {
  return toDecimal(value).isZero();
}
