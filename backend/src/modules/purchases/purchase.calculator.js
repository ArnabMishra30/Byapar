import { add, subtract, multiply, divide, round, toDecimal, isGreaterThan } from '../../utils/money.js';
import { ApiError } from '../../utils/api-error.js';
import {
  calculateGstAmounts,
  isNonTaxableTreatment,
  TAX_TREATMENT,
} from '../tax/gst.calculator.js';

// Pure calculation for a purchase. No database, no HTTP - so it can be unit tested
// directly and reused by any future document type that works the same way.
//
// ROUNDING POLICY
//   Every intermediate value keeps full Decimal precision.
//   Each stored monetary value is rounded ONCE, to 4 decimal places (the column
//   precision), at the moment it is produced.
//   Purchase totals are the sum of the ALREADY ROUNDED line values, so the printed
//   lines always add up to the printed total. Summing unrounded values and rounding
//   at the end would produce a total that does not match the visible lines.
//
// Per line:
//   gross          = quantity * unitCost
//   discountAmount = NONE       -> 0
//                    PERCENTAGE -> gross * value / 100
//                    FIXED      -> value            (applies to the whole line)
//   taxableAmount  = gross - discountAmount
//   taxAmount      = taxableAmount * taxRate / 100
//   lineTotal      = taxableAmount + taxAmount
//
// GST (added in the tax phase, and OPTIONAL)
//   When a `gst` block is supplied - which happens only for a company that has
//   enabled GST - the tax is computed as CGST + SGST or as IGST, and taxAmount
//   becomes the SUM OF THOSE COMPONENTS rather than a separately rounded figure.
//   That is what makes "components add up to the tax" true at every rate.
//   Without a `gst` block the arithmetic is byte-for-byte what it always was.
//
// Purchase:
//   subtotal      = sum(gross)
//   discountTotal = sum(discountAmount)
//   taxTotal      = sum(taxAmount)
//   grandTotal    = sum(lineTotal)

const MONEY_DP = 4;

/**
 * @param {object} line
 * @param {string} line.quantity
 * @param {string} line.unitCost
 * @param {'NONE'|'PERCENTAGE'|'FIXED'} line.discountType
 * @param {string} line.discountValue
 * @param {string|null} line.taxRate  percentage, or null when the line has no tax
 * @param {number} line.index         position, used only for error messages
 * @param {{ supplyType, cgstRate, sgstRate, igstRate, cessRate, treatment }} [line.gst]
 *        present only when the company has GST enabled
 */
export function calculateLine({
  quantity,
  unitCost,
  discountType,
  discountValue,
  taxRate,
  index,
  gst,
}) {
  const gross = round(multiply(quantity, unitCost), MONEY_DP);
  const discountAmount = calculateDiscount({ gross, discountType, discountValue, index });

  const taxableAmount = round(subtract(gross, discountAmount), MONEY_DP);

  const { taxAmount, cgstAmount, sgstAmount, igstAmount, cessAmount } = calculateLineTax({
    taxableAmount,
    taxRate,
    gst,
  });

  const lineTotal = round(add(taxableAmount, taxAmount), MONEY_DP);

  return {
    gross,
    discountAmount,
    taxableAmount,
    taxAmount,
    lineTotal,
    cgstAmount,
    sgstAmount,
    igstAmount,
    cessAmount,
  };
}

const NO_COMPONENTS = {
  cgstAmount: toDecimal(0),
  sgstAmount: toDecimal(0),
  igstAmount: toDecimal(0),
  cessAmount: toDecimal(0),
};

/**
 * The three ways a line can be taxed, in priority order:
 *
 *   1. An exempt / nil-rated / zero-rated line carries no tax, whatever rate is
 *      configured. The treatment is the authority, not the number.
 *   2. A GST-enabled document splits the tax into components, and the total is
 *      the sum of them.
 *   3. Everything else keeps the original single-rate arithmetic.
 *
 * Exported so the split can be unit tested on its own.
 */
export function calculateLineTax({ taxableAmount, taxRate, gst }) {
  const treatment = gst?.treatment ?? TAX_TREATMENT.TAXABLE;

  if (isNonTaxableTreatment(treatment)) {
    return { taxAmount: toDecimal(0), ...NO_COMPONENTS };
  }

  if (gst?.supplyType) {
    const split = calculateGstAmounts({ taxableAmount, ...gst });
    return {
      taxAmount: split.taxAmount,
      cgstAmount: split.cgstAmount,
      sgstAmount: split.sgstAmount,
      igstAmount: split.igstAmount,
      cessAmount: split.cessAmount,
    };
  }

  const taxAmount = taxRate
    ? round(divide(multiply(taxableAmount, taxRate), 100), MONEY_DP)
    : toDecimal(0);

  return { taxAmount, ...NO_COMPONENTS };
}

function calculateDiscount({ gross, discountType, discountValue, index }) {
  if (discountType === 'NONE') return toDecimal(0);

  const value = toDecimal(discountValue ?? 0);

  if (discountType === 'PERCENTAGE') {
    if (isGreaterThan(value, 100)) {
      throw ApiError.business(
        422,
        'INVALID_DISCOUNT',
        `Item ${index + 1}: a percentage discount cannot be greater than 100`,
      );
    }
    return round(divide(multiply(gross, value), 100), MONEY_DP);
  }

  // FIXED: an absolute amount off this line, never more than the line is worth.
  if (isGreaterThan(value, gross)) {
    throw ApiError.business(
      422,
      'INVALID_DISCOUNT',
      `Item ${index + 1}: the discount cannot be greater than the line amount`,
    );
  }

  return round(value, MONEY_DP);
}

/**
 * Totals a set of already-calculated lines.
 * @param {Array<{ gross, discountAmount, taxAmount, lineTotal }>} lines
 */
export function calculateTotals(lines) {
  return lines.reduce(
    (totals, line) => ({
      subtotal: add(totals.subtotal, line.gross),
      discountTotal: add(totals.discountTotal, line.discountAmount),
      taxTotal: add(totals.taxTotal, line.taxAmount),
      grandTotal: add(totals.grandTotal, line.lineTotal),
      // Zero on every pre-GST document, so the totals above are unchanged.
      cgstTotal: add(totals.cgstTotal, line.cgstAmount ?? 0),
      sgstTotal: add(totals.sgstTotal, line.sgstAmount ?? 0),
      igstTotal: add(totals.igstTotal, line.igstAmount ?? 0),
      cessTotal: add(totals.cessTotal, line.cessAmount ?? 0),
    }),
    {
      subtotal: toDecimal(0),
      discountTotal: toDecimal(0),
      taxTotal: toDecimal(0),
      grandTotal: toDecimal(0),
      cgstTotal: toDecimal(0),
      sgstTotal: toDecimal(0),
      igstTotal: toDecimal(0),
      cessTotal: toDecimal(0),
    },
  );
}
