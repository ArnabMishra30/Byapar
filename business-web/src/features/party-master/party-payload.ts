import type { CreatePartyInput, PartyInput, PartyMatch, PartyRelationship } from "@/lib/api/parties";

// WHAT THE PARTY FORM SENDS.
//
// Kept apart from the screen because the rules are worth testing on their own:
// blanks become "nothing" rather than empty strings the backend would reject,
// and credit terms go only to the side(s) the party actually has.

export interface PartyFormValues {
  relationship: PartyRelationship;
  name: string;
  phone: string;
  alternatePhone: string;
  email: string;
  contactPerson: string;
  address: string;
  city: string;
  stateCode: string;
  pincode: string;
  gstin: string;
  pan: string;
  notes: string;
  /** Days this customer gets to pay you. */
  customerCreditDays: string;
  /** Most this customer may owe at once. Blank or 0 means no limit. */
  customerCreditLimit: string;
  /** Days this supplier gives you to pay. */
  supplierCreditDays: string;
}

export const EMPTY_PARTY_FORM: PartyFormValues = {
  relationship: "CUSTOMER",
  name: "",
  phone: "",
  alternatePhone: "",
  email: "",
  contactPerson: "",
  address: "",
  city: "",
  stateCode: "",
  pincode: "",
  gstin: "",
  pan: "",
  notes: "",
  customerCreditDays: "",
  customerCreditLimit: "",
  supplierCreditDays: "",
};

const text = (value: string) => {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const days = (value: string): number | null | undefined => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

/** Field-level problems the backend would also catch, found before sending. */
export function validatePartyForm(values: PartyFormValues): Partial<Record<keyof PartyFormValues, string>> {
  const errors: Partial<Record<keyof PartyFormValues, string>> = {};
  if (values.name.trim().length < 2) errors.name = "Enter at least 2 characters";
  for (const key of ["phone", "alternatePhone"] as const) {
    if (values[key].trim() && !/^[+]?[0-9\s-]{7,20}$/.test(values[key].trim())) errors[key] = "Enter a valid phone number";
  }
  if (values.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) errors.email = "Enter a valid email";
  if (values.pincode.trim() && !/^\d{6}$/.test(values.pincode.trim())) errors.pincode = "A pincode is six digits";
  // GSTIN is optional; checked only when typed.
  if (values.gstin.trim() && !/^[0-9A-Z]{15}$/i.test(values.gstin.trim())) errors.gstin = "A GSTIN is 15 letters and digits";
  if (values.pan.trim() && !/^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(values.pan.trim())) errors.pan = "Enter a valid PAN, e.g. ABCDE1234F";
  for (const key of ["customerCreditDays", "supplierCreditDays"] as const) {
    if (values[key].trim() && days(values[key]) === undefined) errors[key] = "Whole days, 0 or more";
  }
  if (values.customerCreditLimit.trim() && !/^\d+(\.\d{1,2})?$/.test(values.customerCreditLimit.trim())) {
    errors.customerCreditLimit = "Enter an amount";
  }
  return errors;
}

function common(values: PartyFormValues): PartyInput {
  return {
    name: values.name.trim(),
    phone: text(values.phone),
    alternatePhone: text(values.alternatePhone),
    email: text(values.email),
    contactPerson: text(values.contactPerson),
    address: text(values.address),
    city: text(values.city),
    stateCode: text(values.stateCode),
    pincode: text(values.pincode),
    gstin: text(values.gstin)?.toUpperCase() ?? null,
    pan: text(values.pan)?.toUpperCase() ?? null,
    notes: text(values.notes),
  };
}

function sideTerms(values: PartyFormValues, isCustomer: boolean, isSupplier: boolean) {
  const out: Pick<PartyInput, "customer" | "supplier"> = {};
  if (isCustomer) {
    const customer: NonNullable<PartyInput["customer"]> = {};
    const d = days(values.customerCreditDays);
    if (d !== undefined) customer.creditDays = d;
    if (values.customerCreditLimit.trim()) customer.creditLimit = values.customerCreditLimit.trim();
    if (Object.keys(customer).length > 0) out.customer = customer;
  }
  if (isSupplier) {
    const d = days(values.supplierCreditDays);
    if (d !== undefined) out.supplier = { creditDays: d };
  }
  return out;
}

export function toCreatePayload(values: PartyFormValues, allowDuplicate = false): CreatePartyInput {
  const isCustomer = values.relationship !== "SUPPLIER";
  const isSupplier = values.relationship !== "CUSTOMER";
  return {
    ...common(values),
    relationship: values.relationship,
    ...sideTerms(values, isCustomer, isSupplier),
    ...(allowDuplicate ? { allowDuplicate: true } : {}),
  };
}

/** An edit: common details, plus terms for whichever sides the party has. */
export function toUpdatePayload(
  values: PartyFormValues,
  sides: { isCustomer: boolean; isSupplier: boolean },
): Partial<PartyInput> {
  return { ...common(values), ...sideTerms(values, sides.isCustomer, sides.isSupplier) };
}

export const MATCH_REASON_LABEL: Record<PartyMatch["reasons"][number], string> = {
  gstin: "same GSTIN",
  phone: "same mobile",
  email: "same email",
  name: "same name",
};

/**
 * What choosing an existing party would still need, given what the shop was
 * trying to add. "Use existing" on a customer-only party when the shop wanted a
 * supplier means giving that party a supplier side, not just opening it.
 */
export function missingSides(
  wanted: PartyRelationship,
  existing: PartyMatch["party"]["relationship"],
): Array<"CUSTOMER" | "SUPPLIER"> {
  const has = {
    CUSTOMER: existing === "CUSTOMER" || existing === "BOTH",
    SUPPLIER: existing === "SUPPLIER" || existing === "BOTH",
  };
  const needs: Array<"CUSTOMER" | "SUPPLIER"> =
    wanted === "BOTH" ? ["CUSTOMER", "SUPPLIER"] : [wanted];
  return needs.filter((side) => !has[side]);
}
