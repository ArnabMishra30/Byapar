export const APP_CONFIG = {
  name: "Byapar",
  tagline: "Business & Shop Management",
  /**
   * The API, on this site's own origin. next.config.mjs proxies it to the
   * Express backend, which keeps the session cookies first-party.
   */
  apiUrl: "/api/v1",
  /**
   * False only in a production build made without a backend URL (set by
   * next.config.mjs). Without one the public site still works and API calls
   * fail with a clear message instead of a vague 404.
   */
  apiConfigured: process.env.BYAPAR_API_CONFIGURED !== "false",
  /**
   * NOT a credential. The session lives in httpOnly cookies no script can read,
   * so this flag is how the app knows a session is worth checking for, without
   * asking the server on every visit to the landing page.
   */
  sessionHintKey: "byapar_business_signed_in",
  /** Where the token lived before cookies. Removed on sight. */
  legacyTokenKey: "byapar_business_token",
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
  quickBilling: `${SHOP_PREFIX}/quick-billing`,
  bills: `${SHOP_PREFIX}/bills`,

  sales: `${SHOP_PREFIX}/sales`,
  salesInvoices: `${SHOP_PREFIX}/sales/invoices`,
  newSale: `${SHOP_PREFIX}/sales/new`,
  salesReturns: `${SHOP_PREFIX}/sales/returns`,
  newSalesReturn: `${SHOP_PREFIX}/sales/returns/new`,

  purchases: `${SHOP_PREFIX}/purchases`,
  purchaseBills: `${SHOP_PREFIX}/purchases/bills`,
  newPurchase: `${SHOP_PREFIX}/purchases/new`,
  purchaseReturns: `${SHOP_PREFIX}/purchases/returns`,
  newPurchaseReturn: `${SHOP_PREFIX}/purchases/returns/new`,
  supplierPayables: `${SHOP_PREFIX}/purchases/payables`,

  stock: `${SHOP_PREFIX}/stock`,
  products: `${SHOP_PREFIX}/stock/products`,
  stockIn: `${SHOP_PREFIX}/stock/in`,
  stockOut: `${SHOP_PREFIX}/stock/out`,
  stockAdjustments: `${SHOP_PREFIX}/stock/adjustments`,
  lowStock: `${SHOP_PREFIX}/stock/low-stock`,

  // A party is the business behind a customer, a supplier, or both.
  parties: `${SHOP_PREFIX}/parties`,
  newParty: `${SHOP_PREFIX}/parties/new`,

  customers: `${SHOP_PREFIX}/customers`,
  newCustomer: `${SHOP_PREFIX}/customers/new`,
  importCustomers: `${SHOP_PREFIX}/customers/import`,
  creditBook: `${SHOP_PREFIX}/credit-book`,
  suppliers: `${SHOP_PREFIX}/suppliers`,

  moneyReceived: `${SHOP_PREFIX}/money/received`,
  moneyPaid: `${SHOP_PREFIX}/money/paid`,
  expenses: `${SHOP_PREFIX}/expenses`,
  cashBank: `${SHOP_PREFIX}/cash-bank`,

  salesReport: `${SHOP_PREFIX}/reports/sales`,
  purchaseReport: `${SHOP_PREFIX}/reports/purchases`,
  stockReport: `${SHOP_PREFIX}/reports/stock`,
  customerReport: `${SHOP_PREFIX}/reports/customers`,
  supplierReport: `${SHOP_PREFIX}/reports/suppliers`,
  expenseReport: `${SHOP_PREFIX}/reports/expenses`,
  profitLoss: `${SHOP_PREFIX}/reports/profit-loss`,
  gstReport: `${SHOP_PREFIX}/reports/gst`,
  gstRegistration: `${SHOP_PREFIX}/gst`,

  settings: `${SHOP_PREFIX}/settings`,
  staff: `${SHOP_PREFIX}/settings/staff`,
  profile: `${SHOP_PREFIX}/profile`,
  subscription: `${SHOP_PREFIX}/subscription`,
  recycleBin: `${SHOP_PREFIX}/recycle-bin`,

  accounts: `${SHOP_PREFIX}/accounting/accounts`,
  journal: `${SHOP_PREFIX}/accounting/journal`,
  openingBalance: `${SHOP_PREFIX}/accounting/opening-balance`,
  periods: `${SHOP_PREFIX}/accounting/periods`,
} as const;

/** Detail pages, which need an id. */
export const DETAIL_ROUTES = {
  sale: (id: string) => `${SHOP_PREFIX}/sales/${id}`,
  salesReturn: (id: string) => `${SHOP_PREFIX}/sales/returns/${id}`,
  purchase: (id: string) => `${SHOP_PREFIX}/purchases/${id}`,
  purchaseReturn: (id: string) => `${SHOP_PREFIX}/purchases/returns/${id}`,
  product: (id: string) => `${SHOP_PREFIX}/stock/products/${id}`,
  customer: (id: string) => `${SHOP_PREFIX}/customers/${id}`,
  supplier: (id: string) => `${SHOP_PREFIX}/suppliers/${id}`,
  party: (id: string) => `${SHOP_PREFIX}/parties/${id}`,
  bill: (id: string) => `${SHOP_PREFIX}/bills/${id}`,
};

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
  | "BadgeCheck"
  | "Zap"
  | "FileText"
  | "Undo2"
  | "Package"
  | "PackagePlus"
  | "PackageMinus"
  | "SlidersHorizontal"
  | "TriangleAlert"
  | "UserPlus"
  | "Upload"
  | "HandCoins"
  | "PieChart"
  | "TrendingUp"
  | "Trash2"
  | "Warehouse";

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
 * ONLY WHAT THE BACKEND CAN DO. A destination is listed only when a real API
 * backs it. Documents the backend has no model for yet (estimates, sales
 * orders, delivery challans, purchase orders, stock transfers, expiry) are not
 * listed; each module's landing page says plainly what is not available.
 *
 * Business language at the top where a shop owner works, accounting language
 * at the bottom where an accountant does. "Customer owes you" and "You owe
 * supplier" are the same numbers the ledger calls receivables and payables -
 * the words change, the figures do not.
 */
export const NAVIGATION: NavSection[] = [
  {
    title: "Overview",
    items: [
      { title: "Home", href: ROUTES.dashboard, icon: "LayoutDashboard" },
      { title: "Quick Billing", href: ROUTES.quickBilling, icon: "Zap" },
      { title: "Bill Import", href: ROUTES.bills, icon: "ScanLine" },
    ],
  },
  {
    title: "Sales",
    items: [
      { title: "Sales", href: ROUTES.sales, icon: "Receipt" },
      { title: "Invoices", href: ROUTES.salesInvoices, icon: "FileText" },
      { title: "Sales Returns", href: ROUTES.salesReturns, icon: "Undo2" },
    ],
  },
  {
    title: "Purchase",
    items: [
      { title: "Purchases", href: ROUTES.purchases, icon: "ShoppingCart" },
      { title: "Purchase Bills", href: ROUTES.purchaseBills, icon: "FileText" },
      { title: "Purchase Returns", href: ROUTES.purchaseReturns, icon: "Undo2" },
      { title: "Supplier Payables", href: ROUTES.supplierPayables, icon: "HandCoins" },
    ],
  },
  {
    title: "Stock & Inventory",
    items: [
      { title: "Stock Dashboard", href: ROUTES.stock, icon: "Boxes" },
      { title: "Products / Items", href: ROUTES.products, icon: "Package" },
      { title: "Stock In", href: ROUTES.stockIn, icon: "PackagePlus" },
      { title: "Stock Out", href: ROUTES.stockOut, icon: "PackageMinus" },
      { title: "Stock Adjustments", href: ROUTES.stockAdjustments, icon: "SlidersHorizontal" },
      { title: "Low Stock", href: ROUTES.lowStock, icon: "TriangleAlert" },
    ],
  },
  {
    title: "Parties",
    items: [
      { title: "All Parties", href: ROUTES.parties, icon: "Users" },
      { title: "Add Party", href: ROUTES.newParty, icon: "UserPlus", adminOnly: true },
    ],
  },
  {
    title: "Customers",
    items: [
      { title: "Customers", href: ROUTES.customers, icon: "UserCheck" },
      { title: "Add Customer", href: ROUTES.newCustomer, icon: "UserPlus", adminOnly: true },
      {
        title: "Bulk Upload Customers",
        href: ROUTES.importCustomers,
        icon: "Upload",
        adminOnly: true,
      },
      { title: "Credit Book", href: ROUTES.creditBook, icon: "BookOpen" },
    ],
  },
  {
    title: "Suppliers",
    items: [{ title: "Suppliers", href: ROUTES.suppliers, icon: "Truck" }],
  },
  {
    title: "Money",
    items: [
      { title: "Money Received", href: ROUTES.moneyReceived, icon: "ArrowDownLeft" },
      { title: "Money Paid", href: ROUTES.moneyPaid, icon: "ArrowUpRight" },
      { title: "Expenses", href: ROUTES.expenses, icon: "Wallet" },
      { title: "Cash & Bank", href: ROUTES.cashBank, icon: "Landmark" },
    ],
  },
  {
    title: "Reports",
    items: [
      { title: "Sales Reports", href: ROUTES.salesReport, icon: "TrendingUp" },
      { title: "Purchase Reports", href: ROUTES.purchaseReport, icon: "BarChart3" },
      { title: "Stock Reports", href: ROUTES.stockReport, icon: "Warehouse" },
      { title: "Customer Reports", href: ROUTES.customerReport, icon: "UserCheck" },
      { title: "Supplier Reports", href: ROUTES.supplierReport, icon: "Truck" },
      { title: "Expense Reports", href: ROUTES.expenseReport, icon: "Wallet" },
      { title: "Profit & Loss", href: ROUTES.profitLoss, icon: "PieChart" },
    ],
  },
  {
    // Only for a GST-registered shop. A local shop never sees a tax menu.
    title: "Tax",
    requireGst: true,
    items: [
      { title: "GST Reports", href: ROUTES.gstReport, icon: "ShieldCheck", requireGst: true },
      { title: "GST Registration", href: ROUTES.gstRegistration, icon: "BadgeCheck", requireGst: true },
    ],
  },
  {
    title: "Settings",
    items: [
      { title: "Business Settings", href: ROUTES.settings, icon: "Settings" },
      { title: "Staff", href: ROUTES.staff, icon: "Users", adminOnly: true },
      { title: "My Profile", href: ROUTES.profile, icon: "UserCog" },
      { title: "Subscription", href: ROUTES.subscription, icon: "BadgeCheck" },
      { title: "Recycle Bin", href: ROUTES.recycleBin, icon: "Trash2" },
    ],
  },
  {
    // For the accountant: kept last and out of a shopkeeper's way.
    title: "Accountant",
    items: [
      { title: "Accounts", href: ROUTES.accounts, icon: "BookMarked" },
      { title: "Journal & Ledger", href: ROUTES.journal, icon: "Scale" },
      { title: "Opening Balance", href: ROUTES.openingBalance, icon: "PlayCircle", adminOnly: true },
      { title: "Accounting Periods", href: ROUTES.periods, icon: "CalendarRange", adminOnly: true },
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
