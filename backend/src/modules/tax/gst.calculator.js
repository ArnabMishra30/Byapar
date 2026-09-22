import { add, subtract, multiply, divide, round, toDecimal, isZero, isGreaterThan } from '../../utils/money.js';
import { ApiError } from '../../utils/api-error.js';

// The GST calculator. Pure Decimal arithmetic - no database, no HTTP, no dates.
//
// THE ONE RULE THAT MATTERS
//   Intra-state supply -> CGST + SGST
//   Inter-state supply -> IGST
//   Never both. Which one applies is decided ONLY by comparing the seller's state
//   with the place of supply, never by what a client sends.
//
// ROUNDING POLICY (the same one the rest of the project uses)
//   Every component is rounded ONCE, to 4 decimal places, as it is produced.
//   The line's total tax is then the SUM OF THOSE ROUNDED COMPONENTS - it is not
//   computed independently and reconciled afterwards. That is what makes
//       cgstAmount + sgstAmount + igstAmount + cessAmount === taxAmount
//   true by construction rather than by luck, at every rate and every quantity.

const MONEY_DP = 4;
const RATE_DP = 2;

export const SUPPLY_TYPE = {
  INTRA_STATE: 'INTRA_STATE',
  INTER_STATE: 'INTER_STATE',
};

export const TAX_TREATMENT = {
  TAXABLE: 'TAXABLE',
  EXEMPT: 'EXEMPT',
  NIL_RATED: 'NIL_RATED',
  ZERO_RATED: 'ZERO_RATED',
};

/** A treatment that must never carry tax, whatever rate is configured. */
export function isNonTaxableTreatment(treatment) {
  return (
    treatment === TAX_TREATMENT.EXEMPT ||
    treatment === TAX_TREATMENT.NIL_RATED ||
    treatment === TAX_TREATMENT.ZERO_RATED
  );
}

/**
 * Intra-state or inter-state, from the two states alone.
 *
 * Returns null when either state is unknown - the caller must then refuse the
 * document rather than guess. Guessing here would silently charge the wrong tax.
 */
export function determineSupplyType(sellerStateCode, placeOfSupplyStateCode) {
  if (!sellerStateCode || !placeOfSupplyStateCode) return null;

  return sellerStateCode === placeOfSupplyStateCode
    ? SUPPLY_TYPE.INTRA_STATE
    : SUPPLY_TYPE.INTER_STATE;
}

/**
 * Derives the component rates from a headline rate, the way GST always splits:
 * half each to CGST and SGST, the whole rate to IGST.
 *
 * Used to fill in a tax master that only has a total rate. A rate with an odd
 * number of paise (e.g. 5.01) cannot be halved exactly at 2 decimal places and
 * is rejected rather than silently rounded - a half-paise error repeated across
 * every line of every invoice is not acceptable.
 */
export function deriveComponentRates(rate) {
  const total = toDecimal(rate ?? 0);
  const half = divide(total, 2);
  const roundedHalf = round(half, RATE_DP);

  if (!subtract(half, roundedHalf).isZero()) {
    throw ApiError.business(
      422,
      'TAX_RATE_NOT_SPLITTABLE',
      `A rate of ${total.toFixed(RATE_DP)} cannot be split evenly into CGST and SGST. Set the components explicitly.`,
    );
  }

  return {
    cgstRate: roundedHalf,
    sgstRate: roundedHalf,
    igstRate: round(total, RATE_DP),
  };
}

/**
 * Checks that a tax master's components agree with its headline rate.
 * Exported so it can be unit tested and reused by validation.
 */
export function assertComponentRatesConsistent({ rate, cgstRate, sgstRate, igstRate }) {
  const total = round(toDecimal(rate ?? 0), RATE_DP);
  const halves = add(toDecimal(cgstRate ?? 0), toDecimal(sgstRate ?? 0));

  if (!subtract(halves, total).isZero()) {
    throw ApiError.business(
      422,
      'TAX_COMPONENT_MISMATCH',
      `CGST + SGST (${halves.toFixed(RATE_DP)}) must equal the total rate (${total.toFixed(RATE_DP)})`,
    );
  }

  if (!subtract(toDecimal(igstRate ?? 0), total).isZero()) {
    throw ApiError.business(
      422,
      'TAX_COMPONENT_MISMATCH',
      `IGST (${toDecimal(igstRate ?? 0).toFixed(RATE_DP)}) must equal the total rate (${total.toFixed(RATE_DP)})`,
    );
  }
}

function percentOf(amount, rate) {
  const value = toDecimal(rate ?? 0);
  if (isZero(value)) return toDecimal(0);
  return round(divide(multiply(amount, value), 100), MONEY_DP);
}

/**
 * The whole point of this module: split a taxable amount into its GST components.
 *
 * @param {object} input
 * @param {any}    input.taxableAmount  already net of discount
 * @param {any}    [input.cgstRate]
 * @param {any}    [input.sgstRate]
 * @param {any}    [input.igstRate]
 * @param {any}    [input.cessRate]
 * @param {'INTRA_STATE'|'INTER_STATE'|null} input.supplyType
 * @param {string} [input.treatment]    EXEMPT / NIL_RATED / ZERO_RATED force zero
 *
 * @returns {{ taxableAmount, cgstAmount, sgstAmount, igstAmount, cessAmount,
 *             taxAmount, totalAmount }} all Prisma Decimals
 */
export function calculateGstAmounts({
  taxableAmount,
  cgstRate,
  sgstRate,
  igstRate,
  cessRate,
  supplyType,
  treatment = TAX_TREATMENT.TAXABLE,
}) {
  const taxable = round(toDecimal(taxableAmount ?? 0), MONEY_DP);

  const zero = {
    taxableAmount: taxable,
    cgstAmount: toDecimal(0),
    sgstAmount: toDecimal(0),
    igstAmount: toDecimal(0),
    cessAmount: toDecimal(0),
    taxAmount: toDecimal(0),
    totalAmount: taxable,
  };

  // An exempt, nil-rated or zero-rated supply carries no tax even if a rate is
  // configured. The treatment is the authority, not the number.
  if (isNonTaxableTreatment(treatment)) return zero;

  // Without a supply type there is no lawful way to choose between IGST and
  // CGST+SGST, so nothing is charged. Callers that require GST must have
  // rejected the document before reaching here.
  if (!supplyType) return zero;

  const isIntraState = supplyType === SUPPLY_TYPE.INTRA_STATE;

  const cgstAmount = isIntraState ? percentOf(taxable, cgstRate) : toDecimal(0);
  const sgstAmount = isIntraState ? percentOf(taxable, sgstRate) : toDecimal(0);
  const igstAmount = isIntraState ? toDecimal(0) : percentOf(taxable, igstRate);
  // Cess applies to both kinds of supply.
  const cessAmount = percentOf(taxable, cessRate);

  const taxAmount = add(add(cgstAmount, sgstAmount), add(igstAmount, cessAmount));

  return {
    taxableAmount: taxable,
    cgstAmount,
    sgstAmount,
    igstAmount,
    cessAmount,
    taxAmount,
    totalAmount: round(add(taxable, taxAmount), MONEY_DP),
  };
}

/**
 * Sums the tax components of several already-calculated lines.
 * Summing already-rounded values, so a document total always equals the sum of
 * its visible lines.
 */
export function sumGstComponents(lines) {
  return lines.reduce(
    (totals, line) => ({
      cgstTotal: add(totals.cgstTotal, line.cgstAmount ?? 0),
      sgstTotal: add(totals.sgstTotal, line.sgstAmount ?? 0),
      igstTotal: add(totals.igstTotal, line.igstAmount ?? 0),
      cessTotal: add(totals.cessTotal, line.cessAmount ?? 0),
    }),
    {
      cgstTotal: toDecimal(0),
      sgstTotal: toDecimal(0),
      igstTotal: toDecimal(0),
      cessTotal: toDecimal(0),
    },
  );
}

/**
 * The invariants a posted document must satisfy. Called inside the posting
 * transaction, so a violation rolls the whole document back rather than being
 * discovered later in a report.
 *
 * @param {{ supplyType, cgstTotal, sgstTotal, igstTotal, cessTotal, taxTotal }} document
 */
export function assertGstTotalsConsistent(document) {
  const cgst = toDecimal(document.cgstTotal ?? 0);
  const sgst = toDecimal(document.sgstTotal ?? 0);
  const igst = toDecimal(document.igstTotal ?? 0);
  const cess = toDecimal(document.cessTotal ?? 0);

  // Rule 3 of the reconciliation invariants: never both, on the same document.
  const hasIntraState = !isZero(cgst) || !isZero(sgst);
  if (hasIntraState && !isZero(igst)) {
    throw ApiError.business(
      422,
      'GST_MIXED_SUPPLY_TYPE',
      'A document cannot carry CGST/SGST and IGST at the same time',
    );
  }

  if (document.supplyType === SUPPLY_TYPE.INTER_STATE && hasIntraState) {
    throw ApiError.business(
      422,
      'GST_MIXED_SUPPLY_TYPE',
      'An inter-state supply is taxed with IGST, not CGST and SGST',
    );
  }
  if (document.supplyType === SUPPLY_TYPE.INTRA_STATE && !isZero(igst)) {
    throw ApiError.business(
      422,
      'GST_MIXED_SUPPLY_TYPE',
      'An intra-state supply is taxed with CGST and SGST, not IGST',
    );
  }

  const componentTotal = add(add(cgst, sgst), add(igst, cess));

  // A document with no supply type was written by a company that has not enabled
  // GST. It has no split to check - but it must not have acquired one either.
  if (!document.supplyType) {
    if (!isZero(componentTotal)) {
      throw ApiError.business(
        422,
        'GST_COMPONENT_TOTAL_MISMATCH',
        'A document with no place of supply cannot carry a GST component split',
      );
    }
    return;
  }

  // Otherwise the split must account for the whole of the tax that was charged.
  const taxTotal = toDecimal(document.taxTotal ?? 0);

  if (!subtract(componentTotal, taxTotal).isZero()) {
    throw ApiError.business(
      422,
      'GST_COMPONENT_TOTAL_MISMATCH',
      `The GST components (${componentTotal.toFixed(2)}) do not add up to the tax total (${taxTotal.toFixed(2)})`,
    );
  }
}

/**
 * True when a tax master may be used on a document with this date.
 * A tax with no window is always usable.
 */
export function isTaxEffectiveOn(tax, date) {
  if (!date) return true;
  if (tax.effectiveFrom && date < tax.effectiveFrom) return false;
  if (tax.effectiveTo && date > tax.effectiveTo) return false;
  return true;
}

/**
 * Reverse calculation, for a price that already INCLUDES tax.
 *
 * Not used by any document today - see the tax-inclusive note in
 * docs/architecture.md - but the arithmetic lives here so that when a
 * tax-inclusive price list arrives there is exactly one implementation of it.
 *
 *   taxable = inclusive * 100 / (100 + totalRate)
 */
export function taxableAmountFromInclusive(inclusiveAmount, totalRate) {
  const rate = toDecimal(totalRate ?? 0);
  const inclusive = toDecimal(inclusiveAmount ?? 0);

  if (isGreaterThan(0, rate)) {
    throw ApiError.business(422, 'INVALID_TAX_RATE', 'A tax rate cannot be negative');
  }

  return round(divide(multiply(inclusive, 100), add(100, rate)), MONEY_DP);
}
