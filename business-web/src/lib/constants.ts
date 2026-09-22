/**
 * Where the Express backend lives.
 *
 * NEXT_PUBLIC_ values are compiled into the JavaScript at BUILD time, so on a
 * host like Render this must be set before the build runs, and changing it
 * needs a redeploy.
 *
 * Development falls back to the local backend. A production build never does:
 * a deployed page pointing at localhost would send every visitor's browser to
 * their own machine. Without a URL the public site still works (pricing shows
 * the configured list) and API calls fail with a clear message instead.
 */
export function resolveApiUrl(env: { NEXT_PUBLIC_API_URL?: string; NODE_ENV?: string }): string {
  const configured = env.NEXT_PUBLIC_API_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  return env.NODE_ENV === "production" ? "" : "http://localhost:4000/api/v1";
}

// Written out in full so Next.js can inline the values at build time.
const apiUrl = resolveApiUrl({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NODE_ENV: process.env.NODE_ENV,
});

export const APP_CONFIG = {
  name: "Byapar",
  tagline: "Business & Shop Management",
  /** A URL, not a secret. Everything NEXT_PUBLIC_ is readable by the browser. */
  apiUrl,
  /** False only in a production build made without NEXT_PUBLIC_API_URL. */
  apiConfigured: apiUrl !== "",
  tokenKey: "byapar_business_token",
  /** Dispatched by the API client on a 401 so the auth provider can react. */
  unauthorizedEvent: "byapar:unauthorized",
};

// --- routes -----------------------------------------------------------------

/**
 * Every path in the shop application lives under /shop.
 *
 * THE PREFIX IS THE POINT. This project serves two audiences from one origin:
 * the public marketing site at / and the shop application at /shop. Keeping the
 * boundary in the URL means nobody has to read a layout file to know which is
 * which, and a stray link cannot quietly drop somebody from one into the other.
 *
 * The PLATFORM admin panel is a different Next.js project entirely, on its own
 * port. Nothing here routes to it.
 */
export const SHOP_PREFIX = "/shop";

export const ROUTES = {
  /** The public marketing site. */
  landing: "/",
  features: "/#features",
  howItWorks: "/#how-it-works",
  pricing: "/#pricing",
  faq: "/#faq",
  /** How a new shop gets started. There is no self-service sign-up. */
  register: "/register",

  /** The shop application. */
  login: `${SHOP_PREFIX}/login`,
  dashboard: `${SHOP_PREFIX}/dashboard`,
  sales: `${SHOP_PREFIX}/sales`,
  purchases: `${SHOP_PREFIX}/purchases`,
  bills: `${SHOP_PREFIX}/bills`,
  subscription: `${SHOP_PREFIX}/subscription`,
} as const;

// --- navigation -------------------------------------------------------------

export type NavIcon =
  | "LayoutDashboard"
  | "Receipt"
  | "ShoppingCart"
  | "Boxes"
  | "UserCheck"
  | "Truck"
  | "BookOpen"
  | "Wallet"
  | "Landmark"
  | "BarChart3"
  | "BookMarked"
  | "Scale"
  | "PlayCircle"
  | "CalendarRange"
  | "ShieldCheck"
  | "Settings"
  | "UserCog"
  | "Users"
  | "ArrowDownLeft"
  | "ArrowUpRight"
  | "ScanLine"
  | "BadgeCheck";

export interface NavItem {
  /** What a shopkeeper calls it - not what an accountant calls it. */
  title: string;
  href: string;
  icon: NavIcon;
  /** Hidden entirely unless the company has GST switched on. */
  requireGst?: boolean;
  /** Hidden for roles that cannot use it at all. UX only - never security. */
  adminOnly?: boolean;
}

export interface NavSection {
  title: string;
  items: NavItem[];
  requireGst?: boolean;
  adminOnly?: boolean;
}

/**
 * The navigation architecture.
 *
 * Business language at the top where a shop owner works, accounting language
 * lower down where an accountant does. "Customer Credit" and "Supplier Dues"
 * are the same numbers the ledger calls receivables and payables - the words
 * change, the figures do not.
 */
export const NAVIGATION: NavSection[] = [
  {
    title: "Overview",
    items: [{ title: "Dashboard", href: `${SHOP_PREFIX}/dashboard`, icon: "LayoutDashboard" }],
  },
  {
    title: "Business",
    items: [
      { title: "Sales", href: `${SHOP_PREFIX}/sales`, icon: "Receipt" },
      { title: "Purchases", href: `${SHOP_PREFIX}/purchases`, icon: "ShoppingCart" },
      { title: "Bill Import", href: `${SHOP_PREFIX}/bills`, icon: "ScanLine" },
      { title: "Stock", href: `${SHOP_PREFIX}/inventory`, icon: "Boxes" },
      { title: "Customers", href: `${SHOP_PREFIX}/customers`, icon: "UserCheck" },
      { title: "Suppliers", href: `${SHOP_PREFIX}/suppliers`, icon: "Truck" },
      { title: "Credit Book", href: `${SHOP_PREFIX}/credit`, icon: "BookOpen" },
      { title: "Money Received", href: `${SHOP_PREFIX}/money-in`, icon: "ArrowDownLeft" },
      { title: "Money Paid", href: `${SHOP_PREFIX}/money-out`, icon: "ArrowUpRight" },
      { title: "Expenses", href: `${SHOP_PREFIX}/expenses`, icon: "Wallet" },
      { title: "Cash & Bank", href: `${SHOP_PREFIX}/cash-bank`, icon: "Landmark" },
      { title: "Reports", href: `${SHOP_PREFIX}/reports`, icon: "BarChart3" },
    ],
  },
  {
    title: "Accounting",
    items: [
      { title: "Accounts", href: `${SHOP_PREFIX}/accounting/accounts`, icon: "BookMarked" },
      { title: "Journal & Ledger", href: `${SHOP_PREFIX}/accounting/journal`, icon: "Scale" },
      {
        title: "Opening Balance",
        href: `${SHOP_PREFIX}/accounting/opening-balance`,
        icon: "PlayCircle",
        adminOnly: true,
      },
      {
        title: "Accounting Periods",
        href: `${SHOP_PREFIX}/accounting/periods`,
        icon: "CalendarRange",
        adminOnly: true,
      },
    ],
  },
  {
    title: "Tax",
    requireGst: true,
    items: [
      { title: "GST", href: `${SHOP_PREFIX}/gst`, icon: "ShieldCheck", requireGst: true },
    ],
  },
  {
    title: "Settings",
    items: [
      { title: "Business Settings", href: `${SHOP_PREFIX}/settings`, icon: "Settings" },
      { title: "Subscription", href: `${SHOP_PREFIX}/subscription`, icon: "BadgeCheck" },
      { title: "Staff", href: `${SHOP_PREFIX}/settings/staff`, icon: "Users", adminOnly: true },
      { title: "My Profile", href: `${SHOP_PREFIX}/profile`, icon: "UserCog" },
    ],
  },
];

/** Indian GST state codes, used only when a company has GST switched on. */
export const INDIAN_STATES: { code: string; name: string }[] = [
  { code: "01", name: "Jammu and Kashmir" },
  { code: "02", name: "Himachal Pradesh" },
  { code: "03", name: "Punjab" },
  { code: "04", name: "Chandigarh" },
  { code: "05", name: "Uttarakhand" },
  { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi" },
  { code: "08", name: "Rajasthan" },
  { code: "09", name: "Uttar Pradesh" },
  { code: "10", name: "Bihar" },
  { code: "11", name: "Sikkim" },
  { code: "12", name: "Arunachal Pradesh" },
  { code: "13", name: "Nagaland" },
  { code: "14", name: "Manipur" },
  { code: "15", name: "Mizoram" },
  { code: "16", name: "Tripura" },
  { code: "17", name: "Meghalaya" },
  { code: "18", name: "Assam" },
  { code: "19", name: "West Bengal" },
  { code: "20", name: "Jharkhand" },
  { code: "21", name: "Odisha" },
  { code: "22", name: "Chhattisgarh" },
  { code: "23", name: "Madhya Pradesh" },
  { code: "24", name: "Gujarat" },
  { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu" },
  { code: "27", name: "Maharashtra" },
  { code: "29", name: "Karnataka" },
  { code: "30", name: "Goa" },
  { code: "31", name: "Lakshadweep" },
  { code: "32", name: "Kerala" },
  { code: "33", name: "Tamil Nadu" },
  { code: "34", name: "Puducherry" },
  { code: "35", name: "Andaman and Nicobar Islands" },
  { code: "36", name: "Telangana" },
  { code: "37", name: "Andhra Pradesh" },
  { code: "38", name: "Ladakh" },
  { code: "97", name: "Other Territory" },
];
