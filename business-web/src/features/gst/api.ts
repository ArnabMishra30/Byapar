import { getOne, patchOne, postOne } from "@/lib/api";
import type { GstProfile, GstRegistrationType } from "@/types/api";

/**
 * The GST registration endpoints the shared gstApi does not cover.
 *
 * PATCH /tax/profile accepts more than the shared wrapper types (legal name
 * and registered address too), and there are two read-only helpers: the list
 * of GST states, and a format + checksum check of a GSTIN. All admin-gated
 * writes are refused by the backend for staff regardless of this file.
 */

export interface GstState {
  code: string;
  name: string;
}

export interface GstinCheck {
  gstin: string | null;
  valid: boolean;
  reason: string | null;
  stateCode: string | null;
  stateName: string | null;
  pan: string | null;
  note?: string;
}

export interface GstProfileUpdate {
  gstin?: string | null;
  legalName?: string | null;
  stateCode?: string | null;
  registeredAddress?: string | null;
  registrationType?: GstRegistrationType;
}

export const gstRegistrationApi = {
  states: () => getOne<GstState[]>("/tax/states", "states"),
  /** Format and checksum only; it cannot tell whether a GSTIN is active. */
  validateGstin: (gstin: string) => postOne<GstinCheck>("/tax/validate-gstin", "gstin", { gstin }),
  update: (body: GstProfileUpdate) => patchOne<GstProfile>("/tax/profile", "gstProfile", body),
};

export const REGISTRATION_TYPES: { value: GstRegistrationType; label: string; hint: string }[] = [
  { value: "REGULAR", label: "Regular", hint: "Charges GST on sales and claims tax paid on purchases." },
  { value: "COMPOSITION", label: "Composition", hint: "Pays a fixed rate on turnover; cannot charge GST." },
  { value: "UNREGISTERED", label: "Not registered", hint: "No GSTIN. Sales carry no GST." },
  { value: "SEZ", label: "SEZ unit", hint: "A unit in a Special Economic Zone." },
  { value: "OTHER", label: "Other", hint: "Any other registration." },
];

export function registrationLabel(value: string | null | undefined): string {
  return REGISTRATION_TYPES.find((type) => type.value === value)?.label ?? "Not set";
}
