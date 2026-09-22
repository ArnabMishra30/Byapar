import type { UserRole } from "@/types/api";

/**
 * WHAT EACH ROLE CAN ACTUALLY DO.
 *
 * Every entry below was read off the Express route definitions, not guessed.
 * The backend has exactly two roles and no permission table, so this is a
 * faithful mirror of `requireRole('ADMIN')` as it is actually applied:
 *
 *   sales / purchases / expenses / returns
 *     GET, POST, PATCH ............ ADMIN + STAFF   (a staff member drafts)
 *     POST /:id/post, /cancel ..... ADMIN only      (only an admin commits it)
 *
 *   customer-payments / supplier-payments
 *     GET ......................... ADMIN + STAFF
 *     POST, PATCH, post, cancel ... ADMIN only      (the whole write side)
 *
 *   customers / suppliers / products / categories / units / warehouses / taxes
 *     GET ......................... ADMIN + STAFF
 *     POST, PATCH ................. ADMIN only
 *
 *   users ......................... ADMIN only, entire module
 *   company-settings PATCH ........ ADMIN only
 *   tax/profile PATCH ............. ADMIN only
 *   accounting-periods write ...... ADMIN only
 *   opening-balances POST ......... ADMIN only
 *   inventory opening/adjustments . ADMIN only
 *   accounts write, journal reverse ADMIN only
 *
 * THIS FILE IS FOR USER EXPERIENCE ONLY.
 *
 * Hiding a button is not access control. It stops a staff member walking into a
 * 403 they cannot do anything about; it does not stop anybody who means harm.
 * The backend refuses the request either way, and that is the only boundary that
 * counts. Nothing here may ever be relaxed to "make the UI work".
 */
export type Capability =
  // documents
  | "sales.read"
  | "sales.draft"
  | "sales.post"
  | "purchases.read"
  | "purchases.draft"
  | "purchases.post"
  | "expenses.read"
  | "expenses.draft"
  | "expenses.post"
  // money
  | "money.read"
  | "money.receive"
  | "money.pay"
  // master data
  | "parties.read"
  | "parties.manage"
  | "products.read"
  | "products.manage"
  | "inventory.read"
  | "inventory.adjust"
  // accounting
  | "accounting.read"
  | "accounting.manage"
  | "periods.read"
  | "periods.manage"
  | "openingBalances.read"
  | "openingBalances.create"
  // administration
  | "settings.read"
  | "settings.manage"
  | "gst.read"
  | "gst.manage"
  | "staff.manage"
  | "reports.read";

const ADMIN_ONLY: ReadonlySet<Capability> = new Set<Capability>([
  "sales.post",
  "purchases.post",
  "expenses.post",
  "money.receive",
  "money.pay",
  "parties.manage",
  "products.manage",
  "inventory.adjust",
  "accounting.manage",
  "periods.manage",
  "openingBalances.create",
  "settings.manage",
  "gst.manage",
  "staff.manage",
]);

/** Whether a role may do something. Mirrors the backend; never guesses. */
export function can(role: UserRole | undefined | null, capability: Capability): boolean {
  if (!role) return false;
  if (role === "ADMIN") return true;
  return !ADMIN_ONLY.has(capability);
}

/**
 * A short, honest explanation for a disabled control.
 *
 * Telling someone "you cannot do this" without saying who can is a dead end, so
 * every message names the role that can.
 */
export function whyNot(capability: Capability): string {
  switch (capability) {
    case "sales.post":
    case "purchases.post":
    case "expenses.post":
      return "Only an admin can post a document to the books. You can prepare it and save it as a draft.";
    case "money.receive":
      return "Only an admin can record money received.";
    case "money.pay":
      return "Only an admin can record a payment to a supplier.";
    case "parties.manage":
      return "Only an admin can add or edit customers and suppliers.";
    case "products.manage":
      return "Only an admin can add or edit products.";
    case "inventory.adjust":
      return "Only an admin can adjust stock.";
    case "periods.manage":
      return "Only an admin can open or close an accounting period.";
    case "openingBalances.create":
      return "Only an admin can set up opening balances.";
    case "settings.manage":
      return "Only an admin can change business settings.";
    case "gst.manage":
      return "Only an admin can change GST settings.";
    case "staff.manage":
      return "Only an admin can manage staff accounts.";
    case "accounting.manage":
      return "Only an admin can change the chart of accounts.";
    default:
      return "Your account does not have permission for this.";
  }
}
