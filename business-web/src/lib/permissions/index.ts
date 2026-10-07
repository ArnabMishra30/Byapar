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
  // Uploading a bill for the AI to read is open to staff (bill.routes.js has
  // no role gate on POST /bills); only confirming it into the books is ADMIN,
  // which the purchase/sale post capabilities already cover.
  | "bills.upload"
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
  | "reports.read"
  // per-user staff permissions
  | "sales.cancel"
  | "salesReturns.draft"
  | "share.create"
  | "bills.confirm"
  | "customers.create"
  | "sales.discount"
  | "offers.manage";

const ADMIN_ONLY: ReadonlySet<Capability> = new Set<Capability>([
  "sales.post",
  "sales.cancel",
  "share.create",
  "bills.confirm",
  "customers.create",
  "offers.manage",
  // Every purchase write is ADMIN on the backend, drafts included
  // (purchase.routes.js: POST /, PATCH /:id, /post and /cancel all
  // requireRole('ADMIN')). Unlike a sale, staff cannot even prepare one.
  "purchases.draft",
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

/**
 * Which per-user permission (set by the owner on the Staff screen) unlocks each
 * capability for a STAFF member. Any one of the listed permissions is enough.
 * null = open to every shop user; [] = the owner only. Mirrors the backend's
 * requireShopPermission guards.
 */
const STAFF_PERMISSION_FOR: Record<Capability, string[] | null> = {
  "sales.read": null,
  "sales.draft": ["SALES_CREATE", "SALES_POST"],
  "sales.post": ["SALES_POST"],
  "sales.cancel": ["SALES_CANCEL"],
  "salesReturns.draft": ["SALES_CANCEL", "LEGACY_DRAFTS"],
  "purchases.read": ["PURCHASES_MANAGE", "REPORTS_VIEW"],
  "purchases.draft": ["PURCHASES_MANAGE"],
  "purchases.post": ["PURCHASES_MANAGE"],
  "expenses.read": ["EXPENSES_MANAGE", "REPORTS_VIEW", "LEGACY_DRAFTS"],
  "expenses.draft": ["EXPENSES_MANAGE", "LEGACY_DRAFTS"],
  "expenses.post": ["EXPENSES_MANAGE"],
  "bills.upload": null,
  "bills.confirm": ["BILLS_CONFIRM"],
  "money.read": ["MONEY_RECEIVE", "MONEY_PAY", "REPORTS_VIEW"],
  "money.receive": ["MONEY_RECEIVE"],
  "money.pay": ["MONEY_PAY"],
  "parties.read": null,
  "parties.manage": ["PARTIES_MANAGE"],
  "products.read": null,
  "products.manage": ["PRODUCTS_MANAGE"],
  "inventory.read": null,
  "inventory.adjust": ["STOCK_ADJUST"],
  "accounting.read": ["REPORTS_VIEW"],
  "accounting.manage": [],
  "periods.read": null,
  "periods.manage": [],
  "openingBalances.read": ["REPORTS_VIEW"],
  "openingBalances.create": [],
  "settings.read": null,
  "settings.manage": [],
  "gst.read": null,
  "gst.manage": [],
  "staff.manage": [],
  "reports.read": ["REPORTS_VIEW"],
  "share.create": ["SHARE_LINKS"],
  // A cashier adding a walk-in customer from the bill; cannot edit existing ones.
  "customers.create": ["PARTIES_MANAGE", "CUSTOMERS_CREATE"],
  // Discounts, price cuts, and free items given by hand.
  "sales.discount": ["SALES_DISCOUNT"],
  // Setting up Buy X get Y offers.
  "offers.manage": ["PRODUCTS_MANAGE"],
};

/**
 * Whether the signed-in user may do something. Mirrors the backend; never
 * guesses. `shopPermissions` comes from the session (/auth/me); without it the
 * old two-role rule applies.
 */
export function can(
  role: UserRole | undefined | null,
  capability: Capability,
  shopPermissions?: readonly string[] | null,
): boolean {
  if (!role) return false;
  if (role === "ADMIN") return true;
  if (role === "STAFF" && shopPermissions) {
    const needed = STAFF_PERMISSION_FOR[capability];
    if (needed === null) return true;
    return needed.some((permission) => shopPermissions.includes(permission));
  }
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
    case "purchases.draft":
      return "Only an admin can record or change a purchase.";
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
