import { multiply, round, toDecimal } from '../../utils/money.js';
import { calculateLine, calculateTotals } from '../purchases/purchase.calculator.js';

// Pure calculation for a sales invoice. No database, no HTTP.
//
// The line arithmetic - gross, discount, taxable, tax, line total - is IDENTICAL
// to a purchase line, so it is reused rather than copied. Two copies of money
// maths is a correctness hazard: fix a rounding bug in one and the other keeps
// it. If sales ever needs different rules (price-inclusive tax, for example),
// extract the shared part to src/utils/ rather than forking it here.
//
// ROUNDING POLICY (unchanged from purchases):
//   Intermediates keep full Decimal precision. Each stored monetary value is
//   rounded ONCE to 4 dp when produced. Invoice totals are the sum of the
//   already-rounded line values, so printed lines always add up to the printed
//   total.

const MONEY_DP = 4;

/**
 * One sales line. `unitPrice` is what the customer is charged; it has nothing to
 * do with what the stock cost us - that is COGS, resolved at posting time.
 *
 * @param {object} line
 * @param {string} line.quantity
 * @param {string} line.unitPrice
 * @param {'NONE'|'PERCENTAGE'|'FIXED'} line.discountType
 * @param {string} line.discountValue
 * @param {string|null} line.taxRate
 * @param {number} line.index
 */
export function calculateSalesLine({
  quantity,
  unitPrice,
  discountType,
  discountValue,
  taxRate,
  index,
  gst,
}) {
  return calculateLine({
    quantity,
    unitCost: unitPrice,
    discountType,
    discountValue,
    taxRate,
    index,
    // The GST block travels through untouched: a sale splits its tax by exactly
    // the same rules a purchase does.
    gst,
  });
}

/** Totals a set of already-calculated lines. */
export const calculateSalesTotals = calculateTotals;

/**
 * Cost of goods sold for one line, frozen at posting.
 *
 * `cogsUnitCost` is the inventory moving average at the moment the stock left -
 * it is read back from the stock movement the inventory service created, never
 * recomputed here and never taken from the product master.
 */
export function calculateCogs(quantity, cogsUnitCost) {
  return {
    cogsUnitCost: round(toDecimal(cogsUnitCost), MONEY_DP),
    cogsAmount: round(multiply(quantity, cogsUnitCost), MONEY_DP),
  };
}

/** Revenue minus cost, for reporting. Not stored - derived on read. */
export function calculateGrossMargin(taxableAmount, cogsAmount) {
  return round(toDecimal(taxableAmount).minus(toDecimal(cogsAmount)), MONEY_DP);
}
