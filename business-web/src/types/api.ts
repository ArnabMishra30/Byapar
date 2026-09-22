/**
 * Types mirroring the Express backend's actual responses.
 *
 * Money is a STRING everywhere, with two decimals. That is not an oversight: the
 * backend holds money as Decimal end to end and serialises it as a string so it
 * never passes through a JavaScript float. Business Web keeps it that way and
 * does no money arithmetic of its own.
 */

/** Every successful response from the backend has this envelope. */
export interface ApiSuccessResponse<T> {
  success: true;
  message?: string;
  data: T;
}

/** And every failure has this one. */
export interface ApiErrorResponse {
  success: false;
  code?: string;
  message: string;
  errors?: { field: string; message: string }[];
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext?: boolean;
  hasPrev?: boolean;
}

export interface PaginatedResponse<T> {
  success: true;
  data: T[];
  pagination: Pagination;
}

// --- identity ---------------------------------------------------------------

/** The backend has exactly two roles. There is no permission table. */
// A SHOP's roles. ADMIN here means the shop owner, never a platform
// administrator - see lib/auth/roles.ts for the display wording.
export type ShopUserRole = "ADMIN" | "STAFF";

// The platform operator's own roles. They cannot sign in to this application.
export type PlatformUserRole = "PLATFORM_ADMIN" | "SALES_STAFF";

export type UserRole = ShopUserRole | PlatformUserRole;

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  companyId: string;
  isActive?: boolean;
  lastLoginAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export type GstRegistrationType =
  | "UNREGISTERED"
  | "REGULAR"
  | "COMPOSITION"
  | "SEZ"
  | "OTHER";

export interface Company {
  id: string;
  name: string;
  legalName?: string | null;
  gstin?: string | null;
  /** The GST state. Its PRESENCE is what turns GST on for this company. */
  stateCode?: string | null;
  gstRegistrationType?: GstRegistrationType;
  registeredAddress?: string | null;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface CompanySettings {
  id?: string;
  companyId?: string;
  currency: string;
  timezone: string;
  dateFormat: string;
  invoicePrefix: string;
  purchasePrefix: string;
  financialYearStartMonth: number;
  requireOpenPeriod?: boolean;
}

/** GET /tax/profile - the authoritative answer to "is GST on?". */
export interface GstProfile {
  gstEnabled: boolean;
  gstin: string | null;
  stateCode: string | null;
  stateName?: string | null;
  registrationType?: GstRegistrationType | null;
  legalName?: string | null;
  [key: string]: unknown;
}

// --- dashboard --------------------------------------------------------------

export interface MoneyMovement {
  total: string;
  [key: string]: unknown;
}

export interface DashboardPeriodBlock {
  period?: { label?: string; fromDate?: string | null; toDate?: string | null };
  sales?: { total: string; taxTotal?: string; invoiceCount?: number };
  purchases?: { total: string; billCount?: number };
  expenses?: { total: string; expenseCount?: number };
  moneyReceived?: { total: string };
  moneyPaid?: { total: string };
  netCashMovement?: string;
  grossMargin?: string;
  netMargin?: string;
  costOfGoodsSold?: string;
  [key: string]: unknown;
}

export interface DashboardBalances {
  customerReceivables: {
    total: string;
    invoiceCount: number;
    overdue: string;
    overdueCount: number;
  };
  supplierPayables: {
    total: string;
    billCount: number;
    overdue: string;
    overdueCount: number;
  };
  netCreditPosition: string;
  cashAndBank: {
    totalBalance: string;
    accounts?: { code: string; name: string; balance: string }[];
    [key: string]: unknown;
  };
  inventory: {
    totalValue: string;
    itemCount: number;
    lowStockCount: number;
  };
  customerCredit?: {
    customersWithLimit: number;
    customersWithoutLimit: number;
    totalCreditLimit: string;
    availableCredit: string;
    utilisationPercent: string | null;
    overLimitCount: number;
    note?: string;
  };
}

export interface DashboardProfit {
  description?: string;
  revenue: string;
  salesReturns?: string;
  netRevenue?: string;
  costOfGoodsSold: string;
  grossProfit: string;
  operatingExpenses?: string;
  otherExpenses?: string;
  netProfit: string;
  basis?: string;
  period?: { label?: string; fromDate?: string | null; toDate?: string | null };
}

export interface DashboardCollections {
  description?: string;
  date?: string;
  received: {
    total: string;
    allocated?: string;
    unallocated?: string;
    receiptCount: number;
  };
  paid: {
    total: string;
    allocated?: string;
    unallocated?: string;
    paymentCount: number;
  };
  net?: string;
}

export interface Dashboard {
  asOf: string;
  timeZone: string;
  currency: string;
  /** Straight from the backend. Never hard-code this. */
  gstEnabled: boolean;
  today: DashboardPeriodBlock;
  thisWeek: DashboardPeriodBlock;
  thisMonth: DashboardPeriodBlock;
  comparisons?: Record<string, unknown>;
  balances: DashboardBalances;
  collections?: DashboardCollections;
  profit: DashboardProfit;
}

// --- master data ------------------------------------------------------------

export interface Customer {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  gstin?: string | null;
  stateCode?: string | null;
  gstRegistrationType?: GstRegistrationType;
  openingBalance?: string;
  creditLimit?: string;
  /** A limit of 0 means UNLIMITED. The backend publishes this so nothing has to infer it. */
  isUnlimited?: boolean;
  creditDays?: number | null;
  isActive: boolean;
  createdAt?: string;
}

export type Supplier = Customer;

export interface Product {
  id: string;
  name: string;
  sku: string;
  description?: string | null;
  category?: { id: string; name: string } | null;
  unit?: { id: string; name: string; shortCode: string } | null;
  tax?: { id: string; name: string; rate: string } | null;
  purchasePrice?: string;
  sellingPrice?: string;
  reorderLevel?: string;
  isActive: boolean;
}

export interface Warehouse {
  id: string;
  name: string;
  code: string;
  stateCode?: string | null;
  isActive: boolean;
}

export interface Category {
  id: string;
  name: string;
  isActive: boolean;
}

export interface Unit {
  id: string;
  name: string;
  shortCode: string;
  isActive: boolean;
}

export interface Tax {
  id: string;
  name: string;
  rate: string;
  treatment?: string;
  isActive: boolean;
}

// --- documents --------------------------------------------------------------

export type DocumentStatus = "DRAFT" | "POSTED" | "CANCELLED" | "REVERSED";

export interface DocumentLine {
  id: string;
  productId: string;
  productNameSnapshot?: string;
  quantity: string;
  unitPrice?: string;
  unitCost?: string;
  discountType?: string;
  discountValue?: string;
  lineTotal?: string;
  taxAmount?: string;
  [key: string]: unknown;
}

export interface SalesInvoice {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate?: string | null;
  status: DocumentStatus;
  customer: { id: string; name: string };
  subtotal?: string;
  discountTotal?: string;
  taxTotal?: string;
  grandTotal: string;
  notes?: string | null;
  items?: DocumentLine[];
  creditLimitOverride?: { reason: string | null; outstandingAtOverride: string } | null;
  postedAt?: string | null;
  createdAt?: string;
  [key: string]: unknown;
}

export interface Purchase {
  id: string;
  purchaseNumber: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate?: string | null;
  status: DocumentStatus;
  supplier: { id: string; name: string };
  subtotal?: string;
  taxTotal?: string;
  grandTotal: string;
  items?: DocumentLine[];
  createdAt?: string;
  [key: string]: unknown;
}

export interface Expense {
  id: string;
  expenseNumber: string;
  expenseDate: string;
  status: DocumentStatus;
  amount: string;
  description?: string | null;
  category: { accountId: string; code: string; name: string };
  paymentMode: "CASH" | "BANK";
  paidFrom: { accountId: string; code: string; name: string };
  supplier?: { id: string; name: string } | null;
  referenceNumber?: string | null;
  affectsAccounts: boolean;
  createdAt?: string;
  [key: string]: unknown;
}

// --- money ------------------------------------------------------------------

export interface Receivable {
  id: string;
  customer: { id: string; name: string };
  salesInvoice: { id: string; invoiceNumber: string; invoiceDate: string } | null;
  /** SALES_INVOICE, or OPENING_BALANCE when there is no invoice behind it. */
  source?: string;
  originalAmount: string;
  paidAmount: string;
  outstandingAmount: string;
  dueDate?: string | null;
  status: string;
}

export interface Payable {
  id: string;
  supplier: { id: string; name: string };
  purchase: { id: string; purchaseNumber: string; invoiceNumber?: string } | null;
  source?: string;
  originalAmount: string;
  paidAmount: string;
  outstandingAmount: string;
  dueDate?: string | null;
  status: string;
}

export interface PaymentAllocationView {
  id: string;
  amount: string;
  source?: string;
  salesInvoice?: { id: string; invoiceNumber: string } | null;
  purchase?: { id: string; purchaseNumber: string } | null;
}

export interface CustomerPayment {
  id: string;
  paymentNumber: string;
  paymentDate: string;
  status: DocumentStatus;
  customer: { id: string; name: string };
  amount: string;
  allocatedAmount: string;
  unallocatedAmount: string;
  paymentMethod: string;
  referenceNumber?: string | null;
  allocations?: PaymentAllocationView[];
  [key: string]: unknown;
}

export interface SupplierPayment extends Omit<CustomerPayment, "customer"> {
  supplier: { id: string; name: string };
}

// --- stock ------------------------------------------------------------------

export interface StockBalance {
  id: string;
  product: { id: string; name: string; sku: string; reorderLevel?: string | null };
  warehouse: { id: string; name: string; code: string };
  quantity: string;
  averageCost: string;
  inventoryValue: string;
  updatedAt?: string;
}

export interface StockMovement {
  id: string;
  type: string;
  quantity: string;
  unitCost: string;
  totalCost: string;
  quantityAfter?: string;
  referenceType?: string | null;
  notes?: string | null;
  createdAt: string;
  product?: { id: string; name: string; sku: string };
  warehouse?: { id: string; name: string };
}
