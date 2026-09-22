import { ApiError } from '../../utils/api-error.js';
import * as companyRepository from '../companies/company.repository.js';
import { inspectGstin } from './gstin.js';
import { isValidStateCode, stateName, listStates } from './state-codes.js';

// The company's own GST registration.
//
// THIS IS THE SWITCH. A company with no `stateCode` is not GST-aware: its
// documents keep the single-rate behaviour they had before this phase. Setting a
// state code turns GST on, and from that point every document is classified
// intra- or inter-state and refuses to post if a counterparty's state is unknown.
//
// The GSTIN here is validated STRICTLY - structure, state code and checksum -
// because it is printed on every tax invoice the business issues. The looser
// format-only rule still applies to supplier and customer GSTINs; see the
// limitation in docs/architecture.md.

const REGISTERED_TYPES = new Set(['REGULAR', 'COMPOSITION', 'SEZ']);

export function toPublicProfile(company) {
  const inspection = company.gstin ? inspectGstin(company.gstin) : null;

  return {
    companyId: company.id,
    name: company.name,
    legalName: company.legalName ?? null,
    gstin: company.gstin ?? null,
    // Format and checksum only. This is NEVER a claim that the number is
    // registered with the GST portal - nothing here talks to the portal.
    gstinChecksumValid: inspection ? inspection.valid : null,
    registrationType: company.gstRegistrationType,
    stateCode: company.stateCode ?? null,
    stateName: stateName(company.stateCode),
    registeredAddress: company.registeredAddress ?? null,
    // The single question every document flow asks.
    gstEnabled: Boolean(company.stateCode),
  };
}

export async function getProfile(currentUser) {
  const company = await companyRepository.findGstProfile(currentUser.companyId);
  if (!company) throw ApiError.notFound('Company not found');
  return toPublicProfile(company);
}

/**
 * Sets the company's GST registration.
 *
 * Refuses a GSTIN whose embedded state disagrees with the state being set: a
 * GSTIN IS a state registration, so the two disagreeing means one of them is
 * wrong, and guessing which would put a wrong number on every invoice.
 */
export async function updateProfile(currentUser, input) {
  const { companyId } = currentUser;

  const current = await companyRepository.findGstProfile(companyId);
  if (!current) throw ApiError.notFound('Company not found');

  const data = {};

  if (input.gstin !== undefined) {
    if (input.gstin === null) {
      data.gstin = null;
    } else {
      const inspection = inspectGstin(input.gstin);
      if (!inspection.valid) {
        throw ApiError.business(422, 'INVALID_GSTIN', inspection.reason);
      }

      // One GSTIN identifies one legal entity, so it cannot be shared.
      const taken = await companyRepository.findByGstin(input.gstin.trim().toUpperCase());
      if (taken && taken.id !== companyId) {
        throw ApiError.business(409, 'GSTIN_TAKEN', 'That GSTIN belongs to another company');
      }

      data.gstin = input.gstin.trim().toUpperCase();
    }
  }

  if (input.stateCode !== undefined) {
    if (input.stateCode !== null && !isValidStateCode(input.stateCode)) {
      throw ApiError.business(
        422,
        'GST_INVALID_STATE',
        `"${input.stateCode}" is not a valid GST state code`,
      );
    }
    data.stateCode = input.stateCode;
  }

  if (input.legalName !== undefined) data.legalName = input.legalName;
  if (input.registeredAddress !== undefined) data.registeredAddress = input.registeredAddress;
  if (input.registrationType !== undefined) data.gstRegistrationType = input.registrationType;

  const gstin = data.gstin !== undefined ? data.gstin : current.gstin;
  const stateCode = data.stateCode !== undefined ? data.stateCode : current.stateCode;
  const registrationType =
    data.gstRegistrationType !== undefined ? data.gstRegistrationType : current.gstRegistrationType;

  if (gstin && stateCode) {
    const embedded = inspectGstin(gstin).stateCode;
    if (embedded && embedded !== stateCode) {
      throw ApiError.business(
        422,
        'GSTIN_STATE_MISMATCH',
        `The GSTIN is registered in state ${embedded} (${stateName(embedded)}), not ${stateCode} (${stateName(stateCode)})`,
      );
    }
  }

  // A registered business must say which registration it holds.
  if (REGISTERED_TYPES.has(registrationType) && !gstin) {
    throw ApiError.business(
      422,
      'GSTIN_REQUIRED',
      `A ${registrationType} registration needs a GSTIN`,
    );
  }

  if (Object.keys(data).length === 0) {
    throw ApiError.badRequest('Provide at least one field to update');
  }

  const updated = await companyRepository.update(companyId, data);
  return toPublicProfile({ ...current, ...updated, ...data, gstRegistrationType: registrationType });
}

/**
 * Checks a GSTIN without storing it - what a form calls as the user types.
 *
 * Deliberately available to any authenticated user: it is a pure function of the
 * input and reveals nothing about any company's data.
 */
export function validateGstin(value) {
  const inspection = inspectGstin(value);

  return {
    gstin: typeof value === 'string' ? value.trim().toUpperCase() : null,
    valid: inspection.valid,
    reason: inspection.reason,
    stateCode: inspection.stateCode,
    stateName: stateName(inspection.stateCode),
    pan: inspection.pan,
    // Said out loud so no caller can mistake one for the other.
    note: 'Format and checksum only. This does not confirm the GSTIN is registered or active.',
  };
}

/** The state list, for a dropdown. */
export function getStates() {
  return listStates().map((state) => ({ ...state }));
}
