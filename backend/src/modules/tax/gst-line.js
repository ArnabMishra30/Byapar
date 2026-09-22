import { toDecimal } from '../../utils/money.js';
import { ApiError } from '../../utils/api-error.js';
import { SUPPLY_TYPE } from './gst.calculator.js';
import { assertTaxUsable } from './gst-context.service.js';

// The three things every taxable document line needs, in one place so purchases
// and sales cannot drift apart: what tax config to apply, what to freeze onto
// the line, and whether the config is usable at all.

/**
 * The GST block handed to the line calculator.
 *
 * Returns undefined when there is no tax at all - the line is simply untaxed.
 * When GST is off for the company, only the treatment travels: an EXEMPT tax
 * must still charge nothing, but there is no split to compute.
 */
export function buildLineGst(tax, gstContext) {
  if (!tax) return undefined;

  if (!gstContext?.enabled || !gstContext.supplyType) {
    return { treatment: tax.treatment };
  }

  return {
    supplyType: gstContext.supplyType,
    cgstRate: tax.cgstRate,
    sgstRate: tax.sgstRate,
    igstRate: tax.igstRate,
    cessRate: tax.cessRate,
    treatment: tax.treatment,
  };
}

/**
 * What gets FROZEN onto the stored line.
 *
 * Only the rates that were actually applied are recorded: an intra-state line
 * stores CGST and SGST with IGST at zero, and an inter-state line the reverse.
 * The snapshot therefore reproduces the line's own tax by itself, without
 * needing to know the supply type or look anything up.
 */
export function buildLineTaxSnapshot(product, tax, gst, amounts) {
  const snapshot = {
    hsnCodeSnapshot: product?.taxClassification?.code ?? null,
    taxTreatmentSnapshot: tax ? tax.treatment : null,
    cgstRateSnapshot: null,
    sgstRateSnapshot: null,
    igstRateSnapshot: null,
    cessRateSnapshot: null,
    cgstAmount: amounts.cgstAmount,
    sgstAmount: amounts.sgstAmount,
    igstAmount: amounts.igstAmount,
    cessAmount: amounts.cessAmount,
  };

  if (!tax || !gst?.supplyType) return snapshot;

  const isIntraState = gst.supplyType === SUPPLY_TYPE.INTRA_STATE;

  snapshot.cgstRateSnapshot = isIntraState ? tax.cgstRate : toDecimal(0);
  snapshot.sgstRateSnapshot = isIntraState ? tax.sgstRate : toDecimal(0);
  snapshot.igstRateSnapshot = isIntraState ? toDecimal(0) : tax.igstRate;
  snapshot.cessRateSnapshot = tax.cessRate;

  return snapshot;
}

/**
 * A line may only use a tax and a classification that are usable TODAY, on this
 * document's date. Checked when a draft is written and again when it is posted,
 * because either can be retired in between.
 *
 * A classification already frozen onto a posted document is never re-checked -
 * history stays readable after a code is retired.
 */
export function assertLineTaxUsable(product, tax, documentDate, label) {
  if (tax) assertTaxUsable(tax, documentDate, label);

  const classification = product?.taxClassification;
  if (classification && !classification.isActive) {
    throw ApiError.business(
      422,
      'TAX_CLASSIFICATION_INACTIVE',
      `${label}: HSN/SAC ${classification.code} is inactive and cannot be used on a new document`,
    );
  }
}
