import { ApiError } from '../../utils/api-error.js';
import { isValidStateCode, stateName } from './state-codes.js';
import { determineSupplyType, isTaxEffectiveOn, SUPPLY_TYPE } from './gst.calculator.js';
import * as companyRepository from '../companies/company.repository.js';

// Who is supplying whom, from where to where - resolved once per document and
// then FROZEN onto it.
//
// GST IS OPT-IN, AND THE SWITCH IS THE COMPANY'S OWN STATE CODE.
//
// A company that has not set `stateCode` has not told us where it is registered,
// and there is no lawful way to decide between IGST and CGST+SGST without that.
// Rather than guess, such a company keeps exactly the behaviour it had before
// this phase: one tax rate, one tax amount, posted to the aggregate tax accounts.
// The moment it sets a state code, GST turns on and the rules below are enforced
// strictly - including refusing documents whose counterparty state is unknown.
//
// This is what lets an existing installation upgrade without a single historical
// document changing meaning, while a GST-registered business gets full treatment.

/**
 * @typedef {object} GstContext
 * @property {boolean} enabled
 * @property {string|null} sellerGstin
 * @property {string|null} sellerStateCode
 * @property {string|null} buyerGstin
 * @property {string|null} buyerStateCode
 * @property {string|null} placeOfSupplyStateCode
 * @property {'INTRA_STATE'|'INTER_STATE'|null} supplyType
 */

/** What a document stores when the company has not enabled GST. */
const GST_OFF = {
  enabled: false,
  sellerGstin: null,
  sellerStateCode: null,
  buyerGstin: null,
  buyerStateCode: null,
  placeOfSupplyStateCode: null,
  supplyType: null,
};

function assertUsableState(code, label) {
  if (!code) {
    throw ApiError.business(
      422,
      'GST_STATE_REQUIRED',
      `${label} is required once GST is enabled for this company. Set it before posting this document.`,
    );
  }
  if (!isValidStateCode(code)) {
    throw ApiError.business(422, 'GST_INVALID_STATE', `"${code}" is not a valid GST state code`);
  }
  return code;
}

/**
 * A SALE: we are the seller, the customer is the buyer.
 *
 * The place of supply defaults to the customer's state - for goods that is where
 * they are delivered - but may be given explicitly, which is what a bill-to /
 * ship-to difference needs.
 *
 * @param {{ companyId: string }} currentUser
 * @param {{ customer: object, warehouse: object, placeOfSupplyStateCode?: string|null }} input
 * @returns {Promise<GstContext>}
 */
export async function resolveSalesContext(currentUser, { customer, warehouse, placeOfSupplyStateCode }) {
  const company = await companyRepository.findGstProfile(currentUser.companyId);
  if (!company?.stateCode) return GST_OFF;

  // A warehouse in another state supplies from THAT state.
  const sellerStateCode = assertUsableState(
    warehouse?.stateCode ?? company.stateCode,
    'The selling location state',
  );

  const buyerStateCode = customer?.stateCode ?? null;
  const placeOfSupply = assertUsableState(
    placeOfSupplyStateCode ?? buyerStateCode,
    "The place of supply (the customer's state)",
  );

  return {
    enabled: true,
    sellerGstin: company.gstin ?? null,
    sellerStateCode,
    buyerGstin: customer?.gstin ?? null,
    buyerStateCode: buyerStateCode ?? placeOfSupply,
    placeOfSupplyStateCode: placeOfSupply,
    supplyType: determineSupplyType(sellerStateCode, placeOfSupply),
  };
}

/**
 * A PURCHASE: the supplier is the seller, we are the buyer.
 *
 * The place of supply is where the goods arrive - the receiving warehouse's
 * state - which is what decides whether the supplier charged us IGST or
 * CGST+SGST. It is never client-supplied.
 *
 * @returns {Promise<GstContext>}
 */
export async function resolvePurchaseContext(currentUser, { supplier, warehouse }) {
  const company = await companyRepository.findGstProfile(currentUser.companyId);
  if (!company?.stateCode) return GST_OFF;

  const sellerStateCode = assertUsableState(supplier?.stateCode, "The supplier's state");
  const buyerStateCode = assertUsableState(
    warehouse?.stateCode ?? company.stateCode,
    'The receiving location state',
  );

  return {
    enabled: true,
    sellerGstin: supplier?.gstin ?? null,
    sellerStateCode,
    buyerGstin: company.gstin ?? null,
    buyerStateCode,
    // Goods: the place of supply is the destination.
    placeOfSupplyStateCode: buyerStateCode,
    supplyType: determineSupplyType(sellerStateCode, buyerStateCode),
  };
}

/**
 * Rebuilds the context of an already-posted document, for a return raised
 * against it.
 *
 * A credit note must carry the tax treatment of the invoice it reverses, even if
 * the customer has since moved state or the company has changed registration.
 * So the states come from the ORIGINAL document, never from today's masters.
 */
export function contextFromPostedDocument(document) {
  if (!document?.supplyType) return GST_OFF;

  return {
    enabled: true,
    sellerGstin: document.sellerGstin ?? null,
    sellerStateCode: document.sellerStateCode ?? null,
    buyerGstin: document.buyerGstin ?? null,
    buyerStateCode: document.buyerStateCode ?? null,
    placeOfSupplyStateCode: document.placeOfSupplyStateCode ?? null,
    supplyType: document.supplyType,
  };
}

/** The columns a document header stores. Keeps the four services identical. */
export function toDocumentColumns(context) {
  return {
    sellerGstin: context.sellerGstin,
    sellerStateCode: context.sellerStateCode,
    buyerGstin: context.buyerGstin,
    buyerStateCode: context.buyerStateCode,
    placeOfSupplyStateCode: context.placeOfSupplyStateCode,
    supplyType: context.supplyType,
  };
}

/** The public shape of the GST block on a document response. */
export function toPublicGstBlock(document) {
  if (!document.supplyType) return null;

  return {
    supplyType: document.supplyType,
    sellerGstin: document.sellerGstin,
    sellerStateCode: document.sellerStateCode,
    sellerStateName: stateName(document.sellerStateCode),
    buyerGstin: document.buyerGstin,
    buyerStateCode: document.buyerStateCode,
    buyerStateName: stateName(document.buyerStateCode),
    placeOfSupplyStateCode: document.placeOfSupplyStateCode,
    placeOfSupplyStateName: stateName(document.placeOfSupplyStateCode),
  };
}

/**
 * A tax master may only be used on a document if it is active AND its effective
 * window covers the document's date. Checked at draft time and again at posting,
 * because a rate can be retired in between.
 */
export function assertTaxUsable(tax, documentDate, label) {
  if (!tax.isActive) {
    throw ApiError.business(422, 'TAX_INACTIVE', `${label}: tax "${tax.name}" is inactive`);
  }
  if (!isTaxEffectiveOn(tax, documentDate)) {
    throw ApiError.business(
      422,
      'TAX_NOT_EFFECTIVE',
      `${label}: tax "${tax.name}" does not apply on this document's date`,
    );
  }
}

export { SUPPLY_TYPE };
