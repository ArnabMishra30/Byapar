/**
 * Where the Express backend lives.
 *
 * NEXT_PUBLIC_ values are compiled into the JavaScript at BUILD time, so on a
 * host like Render this must be set before the build runs, and changing it
 * needs a redeploy. Development falls back to the local backend; a production
 * build never does, because a deployed console pointing at localhost would send
 * the browser to the operator's own machine.
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
  name: "Byapar ERP",
  description: "Modern Business Management & Accounting Platform",
  /** A URL, not a secret. Everything NEXT_PUBLIC_ is readable by the browser. */
  apiUrl,
  /** False only in a production build made without NEXT_PUBLIC_API_URL. */
  apiConfigured: apiUrl !== "",
  tokenKey: "byapar_access_token",
  companyKey: "byapar_active_company_id",
};

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

export const GST_REGISTRATION_TYPES = [
  { value: "UNREGISTERED", label: "Unregistered (Non-GST / Local Shop)", description: "For businesses not registered for GST" },
  { value: "REGULAR", label: "Regular GST Registered", description: "Standard GST registration with CGST/SGST/IGST" },
  { value: "COMPOSITION", label: "Composition Scheme", description: "Flat tax scheme for small turnover businesses" },
  { value: "SEZ", label: "Special Economic Zone (SEZ)", description: "For units located in SEZ areas" },
  { value: "OTHER", label: "Other Registration", description: "Other government classification" },
];

export const USER_ROLES = [
  { value: "ADMIN", label: "Administrator", description: "Full control over company settings, users, and business data" },
  { value: "STAFF", label: "Staff Member", description: "Operational access to sales, purchases, inventory, and reports" },
];

export interface NavItem {
  title: string;
  href: string;
  icon: string;
  badge?: string;
  roles?: ("ADMIN" | "STAFF" | "PLATFORM_ADMIN" | "SALES_STAFF")[];
  requireGst?: boolean;
  isUpcoming?: boolean;
}

export interface NavSection {
  title: string;
  items: NavItem[];
  roles?: ("ADMIN" | "STAFF" | "PLATFORM_ADMIN" | "SALES_STAFF")[];
  requireGst?: boolean;
}

export const NAVIGATION_CONFIG: NavSection[] = [
  {
    title: "MAIN",
    roles: ["ADMIN", "STAFF"],
    items: [
      { title: "Dashboard", href: "/dashboard", icon: "LayoutDashboard" },
    ],
  },
  // THE SaaS BUSINESS. Only the operator's own people see any of this - a
  // shop's admin has none of these roles. The sidebar hiding it is a courtesy;
  // every one of these routes is permission-gated on the server, which is what
  // actually enforces it.
  {
    title: "PLATFORM",
    roles: ["PLATFORM_ADMIN", "SALES_STAFF"],
    items: [
      {
        title: "Platform Overview",
        href: "/platform",
        icon: "Sparkles",
        roles: ["PLATFORM_ADMIN", "SALES_STAFF"],
      },
      {
        title: "Businesses",
        href: "/platform/businesses",
        icon: "Store",
        roles: ["PLATFORM_ADMIN", "SALES_STAFF"],
      },
      {
        title: "Subscriptions",
        href: "/platform/subscriptions",
        icon: "CalendarClock",
        roles: ["PLATFORM_ADMIN", "SALES_STAFF"],
      },
      {
        title: "Collections",
        href: "/platform/payments",
        icon: "Wallet",
        roles: ["PLATFORM_ADMIN", "SALES_STAFF"],
      },
      // Managing the price list and the team is the operator's job alone.
      {
        title: "Plans & Pricing",
        href: "/platform/plans",
        icon: "Tags",
        roles: ["PLATFORM_ADMIN"],
      },
      {
        title: "Sales Team",
        href: "/platform/sales-team",
        icon: "UsersRound",
        roles: ["PLATFORM_ADMIN"],
      },
    ],
  },
  {
    title: "BUSINESS",
    roles: ["ADMIN", "STAFF"],
    items: [
      { title: "Companies", href: "/admin/companies", icon: "Building2", roles: ["ADMIN"] },
      { title: "Users & Staff", href: "/admin/users", icon: "Users", roles: ["ADMIN"] },
      { title: "Customers", href: "/customers", icon: "UserCheck", badge: "Shop" },
      { title: "Suppliers", href: "/suppliers", icon: "Truck", badge: "Shop" },
      { title: "Sales & Invoices", href: "/sales", icon: "Receipt" },
      { title: "Purchases & Bills", href: "/purchases", icon: "ShoppingCart" },
      { title: "Inventory & Stock", href: "/inventory", icon: "Boxes" },
      { title: "Operating Expenses", href: "/expenses", icon: "Wallet" },
      { title: "Credit Book", href: "/credit", icon: "BookOpen" },
      { title: "Cash & Bank", href: "/reports/cash-bank", icon: "Landmark" },
      { title: "Business Reports", href: "/reports", icon: "BarChart3" },
    ],
  },
  {
    title: "COMPLIANCE",
    roles: ["ADMIN", "STAFF"],
    requireGst: true,
    items: [
      { title: "GST & Tax Master", href: "/gst", icon: "ShieldCheck", requireGst: true },
    ],
  },
  {
    title: "ADMINISTRATION",
    roles: ["ADMIN"],
    items: [
      { title: "Roles & Permissions", href: "/admin/roles", icon: "KeyRound", roles: ["ADMIN"] },
      { title: "Audit Logs", href: "/admin/audit-logs", icon: "History", roles: ["ADMIN"] },
      { title: "System Settings", href: "/admin/settings", icon: "Sliders", roles: ["ADMIN"] },
    ],
  },
  {
    title: "ACCOUNT",
    items: [
      { title: "My Profile", href: "/profile", icon: "UserCog" },
    ],
  },
];
