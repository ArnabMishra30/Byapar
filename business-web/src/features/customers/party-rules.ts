import { z } from "zod";
import type { Customer, GstRegistrationType } from "@/types/api";

/**
 * The rules a customer or supplier must pass, mirrored from the backend.
 *
 * Source of truth: backend/src/modules/customers/customer.validation.js (the
 * supplier module uses the same schema) and backend/src/utils/validation.js.
 * They are repeated here ONLY so a shop owner is told about a bad row before
 * pressing Save, or before a 500-row import. The backend still validates every
 * request and has the final word; if the two ever disagree, the backend wins
 * and its message is shown.
 *
 * Every field arrives as a form string. Blank means "not given".
 */

/** Indian GSTIN: 2-digit state, 10-character PAN, entity number, "Z", checksum. */
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
/** Digits, spaces and dashes, optionally a leading +. 7 to 20 characters. */
export const PHONE_PATTERN = /^[+]?[0-9\s-]{7,20}$/;
/** A positive amount with at most four decimals, as the backend's moneySchema. */
export const MONEY_PATTERN = /^\d+(\.\d{1,4})?$/;
export const MONEY_MAX = 999999999999;

export const REGISTRATION_TYPES: { value: GstRegistrationType; label: string }[] = [
  { value: "REGULAR", label: "Registered (regular)" },
  { value: "COMPOSITION", label: "Composition scheme" },
  { value: "UNREGISTERED", label: "Not registered" },
  { value: "SEZ", label: "SEZ" },
  { value: "OTHER", label: "Other" },
];

const blankOr = (check: (value: string) => boolean, message: string) =>
  z
    .string()
    .trim()
    .refine((value) => value === "" || check(value), message);

const emailCheck = z.string().email().max(255);

export const partySchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(150, "Name must be at most 150 characters"),
  phone: blankOr((v) => PHONE_PATTERN.test(v), "Invalid phone number"),
  email: blankOr((v) => emailCheck.safeParse(v.toLowerCase()).success, "Invalid email address"),
  address: z.string().trim().max(500, "Address is too long"),
  gstin: blankOr((v) => GSTIN_PATTERN.test(v.toUpperCase()), "Invalid GSTIN format"),
  stateCode: blankOr((v) => /^\d{2}$/.test(v), "State code is exactly two digits"),
  gstRegistrationType: blankOr(
    (v) => REGISTRATION_TYPES.some((type) => type.value === v.toUpperCase()),
    "Registration type must be REGULAR, COMPOSITION, UNREGISTERED, SEZ or OTHER",
  ),
  openingBalance: blankOr(
    (v) => MONEY_PATTERN.test(v) && Number(v) <= MONEY_MAX,
    "Opening balance must be a positive number with at most 4 decimals",
  ),
  creditLimit: blankOr(
    (v) => MONEY_PATTERN.test(v) && Number(v) <= MONEY_MAX,
    "Credit limit must be a positive number with at most 4 decimals",
  ),
  creditDays: blankOr(
    (v) => /^\d+$/.test(v) && Number(v) <= 3650,
    "Credit days must be a whole number from 0 to 3650",
  ),
});

export type PartyFormValues = z.infer<typeof partySchema>;

export const EMPTY_PARTY: PartyFormValues = {
  name: "",
  phone: "",
  email: "",
  address: "",
  gstin: "",
  stateCode: "",
  gstRegistrationType: "",
  openingBalance: "",
  creditLimit: "",
  creditDays: "",
};

/** The form values for an existing record. */
export function toFormValues(party: Partial<Customer>): PartyFormValues {
  return {
    name: party.name ?? "",
    phone: party.phone ?? "",
    email: party.email ?? "",
    address: party.address ?? "",
    gstin: party.gstin ?? "",
    stateCode: party.stateCode ?? "",
    gstRegistrationType: party.gstRegistrationType ?? "",
    // A backend "0.00" shows as blank: zero limit means "no limit".
    openingBalance: party.openingBalance && Number(party.openingBalance) !== 0 ? party.openingBalance : "",
    creditLimit: party.creditLimit && Number(party.creditLimit) !== 0 ? party.creditLimit : "",
    creditDays: party.creditDays == null ? "" : String(party.creditDays),
  };
}

/**
 * The request body for a create or an update.
 *
 * On CREATE a blank field is simply left out and the backend applies its
 * default. On UPDATE a blank field has to be sent as null (or "0" for the two
 * money fields, which are not nullable), otherwise clearing a phone number in
 * the form would silently keep the old one.
 *
 * GST fields are sent only when the business uses GST, so a non-GST shop can
 * never submit one by accident.
 */
export function toPartyPayload(
  values: PartyFormValues,
  { mode, includeGst }: { mode: "create" | "update"; includeGst: boolean },
): Partial<Customer> {
  const blank = mode === "create" ? undefined : null;
  const text = (value: string) => (value.trim() === "" ? blank : value.trim());
  const amount = (value: string) => (value.trim() === "" ? (mode === "create" ? undefined : "0") : value.trim());

  const body: Record<string, unknown> = {
    name: values.name.trim(),
    phone: text(values.phone),
    email: values.email.trim() === "" ? blank : values.email.trim().toLowerCase(),
    address: text(values.address),
    openingBalance: amount(values.openingBalance),
    creditLimit: amount(values.creditLimit),
    creditDays: values.creditDays.trim() === "" ? blank : Number(values.creditDays),
  };

  if (includeGst) {
    body.gstin = values.gstin.trim() === "" ? blank : values.gstin.trim().toUpperCase();
    body.stateCode = text(values.stateCode);
    if (values.gstRegistrationType.trim() !== "") {
      body.gstRegistrationType = values.gstRegistrationType.trim().toUpperCase();
    }
  }

  // Undefined keys are dropped so the create body carries only what was typed.
  for (const key of Object.keys(body)) if (body[key] === undefined) delete body[key];
  return body as Partial<Customer>;
}

// --- bulk import ---------------------------------------------------------------

export const IMPORT_COLUMNS = [
  "name",
  "phone",
  "email",
  "address",
  "gstin",
  "stateCode",
  "creditLimit",
  "creditDays",
  "openingBalance",
] as const;

export interface ImportRow {
  /** Line in the uploaded file, header = 1. */
  line: number;
  values: PartyFormValues;
  errors: string[];
}

/**
 * Checks every row of an upload the way the backend would, plus the two things
 * only the whole file can reveal: the same name twice (names are unique per
 * business) and the same phone twice.
 *
 * Normalises one thing a spreadsheet breaks: Excel turns the state code "07"
 * into the number 7, so a single digit is padded back to two.
 */
export function validateImportRows(
  records: { line: number; values: Record<string, string> }[],
): ImportRow[] {
  const nameLines = new Map<string, number>();
  const phoneLines = new Map<string, number>();

  return records.map(({ line, values: raw }) => {
    const stateCode = (raw.stateCode ?? "").trim();
    const values: PartyFormValues = {
      ...EMPTY_PARTY,
      name: raw.name ?? "",
      phone: raw.phone ?? "",
      email: raw.email ?? "",
      address: raw.address ?? "",
      gstin: (raw.gstin ?? "").toUpperCase(),
      stateCode: /^\d$/.test(stateCode) ? `0${stateCode}` : stateCode,
      creditLimit: raw.creditLimit ?? "",
      creditDays: raw.creditDays ?? "",
      openingBalance: raw.openingBalance ?? "",
    };

    const errors: string[] = [];
    const parsed = partySchema.safeParse(values);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        if (!errors.includes(issue.message)) errors.push(issue.message);
      }
    }

    const nameKey = values.name.trim().toLowerCase();
    if (nameKey) {
      const first = nameLines.get(nameKey);
      if (first !== undefined) errors.push(`Same name as line ${first}`);
      else nameLines.set(nameKey, line);
    }

    const phoneKey = values.phone.replace(/[\s-]/g, "");
    if (phoneKey) {
      const first = phoneLines.get(phoneKey);
      if (first !== undefined) errors.push(`Same phone as line ${first}`);
      else phoneLines.set(phoneKey, line);
    }

    return { line, values, errors };
  });
}

export const SAMPLE_CSV_ROWS: string[][] = [
  [...IMPORT_COLUMNS],
  ["Ramesh Traders", "9876543210", "ramesh@example.com", "12, MG Road, Pune", "", "27", "50000", "30", "0"],
  ["Sita Kirana Store", "+91 98765 43211", "", "Main Bazaar, Indore", "", "23", "0", "15", ""],
];
