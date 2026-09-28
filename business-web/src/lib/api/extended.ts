import { getList, getOne, postOne, patchOne, type ListParams } from "./http";
import { apiClient } from "./client";
import type { Pagination } from "@/types/api";

/**
 * Typed access to backend endpoints the shop screens use beyond the basics.
 *
 * EVERY function here is a thin wrapper over an EXISTING Express route. There
 * is no calculation on this side: paid, due, stock value, profit, credit and
 * tax figures are all read from the backend's answer and displayed as-is.
 * Money arrives as strings and stays strings until <Money> formats it.
 */

// --- shared -----------------------------------------------------------------

/** OPEN | PARTIALLY_PAID | PAID | CREDITED | CANCELLED, straight from the ledger. */
export type PaymentStatus = "OPEN" | "PARTIALLY_PAID" | "PAID" | "CREDITED" | "CANCELLED" | null;

export interface PartyRef {
  id: string;
  name: string;
}

export interface Period {
  fromDate: string | null;
  toDate: string | null;
}

// --- sales & purchase registers (invoice-level paid / due) ------------------

export interface SalesRegisterRow {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  customer: PartyRef;
  subtotal: string;
  discount: string;
  tax: string;
  total: string;
  costOfGoodsSold?: string;
  grossMargin?: string;
  paid: string;
  outstanding: string;
  paymentStatus: PaymentStatus;
}

export interface SalesRegister {
  period: Period;
  invoices: SalesRegisterRow[];
  pagination: Pagination;
  totals: {
    invoiceCount: number;
    subtotal: string;
    discount: string;
    tax: string;
    total: string;
    costOfGoodsSold?: string;
    grossMargin?: string;
    returns?: string;
    returnCount?: number;
    netSales?: string;
    [key: string]: unknown;
  };
}

export interface PurchaseRegisterRow {
  id: string;
  purchaseNumber: string;
  supplierInvoiceNumber: string | null;
  invoiceDate: string;
  dueDate: string | null;
  supplier: PartyRef;
  subtotal: string;
  discount: string;
  tax: string;
  total: string;
  paid: string;
  outstanding: string;
  paymentStatus: PaymentStatus;
}

export interface PurchaseRegister {
  period: Period;
  bills: PurchaseRegisterRow[];
  pagination: Pagination;
  totals: {
    billCount: number;
    subtotal: string;
    discount: string;
    tax: string;
    total: string;
    returns?: string;
    returnCount?: number;
    netPurchases?: string;
    [key: string]: unknown;
  };
}

export interface RegisterParams extends ListParams {
  fromDate?: string;
  toDate?: string;
  customerId?: string;
  supplierId?: string;
}

/**
 * POSTED documents only, each with what has been paid and what is still due.
 * Drafts and cancelled documents are not in a register; list them with
 * salesApi / purchasesApi and a status filter.
 */
export const registersApi = {
  sales: (p?: RegisterParams) => getOne<SalesRegister>("/reports/sales", "report", p),
  purchases: (p?: RegisterParams) => getOne<PurchaseRegister>("/reports/purchases", "report", p),
  paymentsReceived: (p?: RegisterParams) =>
    getOne<Record<string, unknown>>("/reports/payments-received", "report", p),
  supplierPayments: (p?: RegisterParams) =>
    getOne<Record<string, unknown>>("/reports/supplier-payments", "report", p),
};

// --- inventory valuation / low stock ---------------------------------------

export interface ValuationItem {
  productId: string;
  product: string;
  sku: string | null;
  warehouse: { id: string; name: string; code: string } | string | null;
  quantity: string;
  averageCost: string;
  value: string;
  reorderLevel: string | null;
  isLowStock: boolean;
}

export interface InventoryValuation {
  asOf: string;
  items: ValuationItem[];
  totals: { itemCount: number; totalValue: string; lowStockCount: number };
  note?: string;
}

export const stockApi = {
  valuation: (p?: { lowStockOnly?: boolean }) =>
    getOne<InventoryValuation>("/reports/inventory-valuation", "report", {
      lowStockOnly: p?.lowStockOnly ? "true" : undefined,
    }),
  balance: (productId: string, warehouseId: string) =>
    getOne<Record<string, unknown>>(`/inventory/${productId}/${warehouseId}`, "balance"),
};

// --- credit book -----------------------------------------------------------

export type AgeingBucket = "UNDATED" | "0-30" | "31-60" | "61-90" | "90+";

export interface CreditPartyRow {
  partyId: string;
  name: string;
  phone: string | null;
  isActive: boolean;
  outstanding: string;
  billed: string;
  paid: string;
  credited: string;
  invoiceCount?: number;
  billCount?: number;
  oldestDocumentDate: string | null;
  oldestDocumentNumber: string | null;
  ageInDays: number | null;
  ageingBucket: AgeingBucket;
  overdue: string;
  overdueCount: number;
  isOverdue: boolean;
  earliestDueDate: string | null;
  lastPayment: { number: string; date: string; amount: string } | null;
  creditLimit?: string | null;
}

export interface CreditList {
  question?: string;
  asOf: string;
  summary: {
    partyCount: number;
    total: string;
    overdue: string;
    notYetDue: string;
    overduePartyCount: number;
    ageing?: Record<string, unknown>;
  };
  customers?: CreditPartyRow[];
  suppliers?: CreditPartyRow[];
  note?: string;
}

export interface CreditListParams {
  asOfDate?: string;
  overdueOnly?: boolean;
  minimumAmount?: string;
}

const creditParams = (p?: CreditListParams) => ({
  asOfDate: p?.asOfDate,
  overdueOnly: p?.overdueOnly ? "true" : undefined,
  minimumAmount: p?.minimumAmount,
});

export const creditBookApi = {
  /** Customers who owe you, one row per customer, with ageing and overdue. */
  customers: (p?: CreditListParams) =>
    getOne<CreditList>("/credit/receivables", "receivables", creditParams(p)),
  /** Suppliers you owe, one row per supplier. */
  suppliers: (p?: CreditListParams) =>
    getOne<CreditList>("/credit/payables", "payables", creditParams(p)),
  /** Totals + top parties for both sides. */
  summary: (p?: { asOfDate?: string }) => getOne<Record<string, unknown>>("/credit", "credit", p),
  /** Per-customer position: open invoices and ledger. */
  customer: (id: string, p?: { fromDate?: string; toDate?: string }) =>
    getOne<Record<string, unknown>>(`/credit/customers/${id}`, "credit", p),
  supplier: (id: string, p?: { fromDate?: string; toDate?: string }) =>
    getOne<Record<string, unknown>>(`/credit/suppliers/${id}`, "credit", p),
};

// --- receivables / payables (invoice-level due dates) -----------------------

export interface ReceivableParams extends ListParams {
  customerId?: string;
  status?: string;
  onlyOutstanding?: boolean;
  invoiceNumber?: string;
  dueDateFrom?: string;
  dueDateTo?: string;
}

export interface PayableParams extends ListParams {
  supplierId?: string;
  status?: string;
  onlyOutstanding?: boolean;
  dueDateFrom?: string;
  dueDateTo?: string;
}

// The Receivable / Payable types already live in @/types/api; these helpers
// only add the filters the backend accepts.
export const dueListsApi = {
  receivables: <T = Record<string, unknown>>(p?: ReceivableParams) =>
    getList<T>("/customer-receivables", {
      ...p,
      onlyOutstanding: p?.onlyOutstanding ? "true" : undefined,
    }),
  payables: <T = Record<string, unknown>>(p?: PayableParams) =>
    getList<T>("/supplier-payables", {
      ...p,
      onlyOutstanding: p?.onlyOutstanding ? "true" : undefined,
    }),
};

// --- returns ----------------------------------------------------------------

export interface ReturnableSaleLine {
  salesInvoiceItemId: string;
  productId: string;
  productName: string;
  sku: string | null;
  unitPrice: string;
  soldQuantity: string;
  returnedQuantity: string;
  remainingQuantity: string;
}

export interface ReturnableSale {
  salesInvoiceId: string;
  invoiceNumber: string;
  status: string;
  customer: PartyRef;
  warehouse: PartyRef;
  lines: ReturnableSaleLine[];
}

export interface ReturnablePurchaseLine {
  purchaseItemId: string;
  productId: string;
  productName: string;
  sku: string | null;
  unitCost: string;
  purchasedQuantity: string;
  returnedQuantity: string;
  remainingQuantity: string;
}

export interface ReturnablePurchase {
  purchaseId: string;
  purchaseNumber: string;
  status: string;
  warehouse: PartyRef;
  lines: ReturnablePurchaseLine[];
}

export interface ReturnDoc {
  id: string;
  returnNumber?: string;
  returnDate: string;
  status: string;
  reason?: string | null;
  notes?: string | null;
  grandTotal?: string;
  subtotal?: string;
  taxTotal?: string;
  customer?: PartyRef;
  supplier?: PartyRef;
  salesInvoice?: { id: string; invoiceNumber: string } | null;
  purchase?: { id: string; purchaseNumber: string } | null;
  items?: Record<string, unknown>[];
  createdAt?: string;
  [key: string]: unknown;
}

export const salesReturnApi = {
  list: (p?: ListParams) => getList<ReturnDoc>("/sales-returns", p),
  get: (id: string) => getOne<ReturnDoc>(`/sales-returns/${id}`, "salesReturn"),
  returnable: (salesInvoiceId: string) =>
    getOne<ReturnableSale>(`/sales-returns/returnable/${salesInvoiceId}`, "returnable"),
  create: (body: {
    salesInvoiceId: string;
    returnDate: string;
    reason?: string;
    notes?: string;
    items: { salesInvoiceItemId: string; quantity: string }[];
  }) => postOne<ReturnDoc>("/sales-returns", "salesReturn", body),
  post: (id: string) => postOne<ReturnDoc>(`/sales-returns/${id}/post`, "salesReturn"),
  cancel: (id: string) => postOne<ReturnDoc>(`/sales-returns/${id}/cancel`, "salesReturn"),
};

export const purchaseReturnApi = {
  list: (p?: ListParams) => getList<ReturnDoc>("/purchase-returns", p),
  get: (id: string) => getOne<ReturnDoc>(`/purchase-returns/${id}`, "purchaseReturn"),
  returnable: (purchaseId: string) =>
    getOne<ReturnablePurchase>(`/purchase-returns/returnable/${purchaseId}`, "returnable"),
  create: (body: {
    purchaseId: string;
    returnDate: string;
    reason?: string;
    notes?: string;
    items: { purchaseItemId: string; quantity: string }[];
  }) => postOne<ReturnDoc>("/purchase-returns", "purchaseReturn", body),
  post: (id: string) => postOne<ReturnDoc>(`/purchase-returns/${id}/post`, "purchaseReturn"),
  cancel: (id: string) => postOne<ReturnDoc>(`/purchase-returns/${id}/cancel`, "purchaseReturn"),
};

// --- staff ------------------------------------------------------------------

export const staffAdminApi = {
  update: (id: string, body: { name?: string; role?: "ADMIN" | "STAFF" }) =>
    patchOne<Record<string, unknown>>(`/users/${id}`, "user", body),
  setStatus: (id: string, isActive: boolean) =>
    patchOne<Record<string, unknown>>(`/users/${id}/status`, "user", { isActive }),
};

// --- GST reports ------------------------------------------------------------

export interface GstRange {
  dateFrom?: string;
  dateTo?: string;
}

export const gstReportsApi = {
  summary: (p?: GstRange) => getOne<Record<string, unknown>>("/tax/gst-summary", "gstSummary", { ...p }),
  outputTax: (p?: GstRange) => getOne<Record<string, unknown>>("/tax/output-tax", "outputTax", { ...p }),
  inputTax: (p?: GstRange) => getOne<Record<string, unknown>>("/tax/input-tax", "inputTax", { ...p }),
  hsnSummary: (source: "SALES_INVOICE" | "PURCHASE" | "SALES_RETURN" | "PURCHASE_RETURN", p?: GstRange) =>
    getOne<Record<string, unknown>>(`/tax/hsn-summary/${source}`, "hsnSummary", { ...p }),
  /** fromDate and toDate are both required by the backend. */
  gstr1: (p: { fromDate: string; toDate: string }) =>
    getOne<Record<string, unknown>>("/tax/returns/gstr-1", "gstr1", p),
  gstr3b: (p: { fromDate: string; toDate: string }) =>
    getOne<Record<string, unknown>>("/tax/returns/gstr-3b", "gstr3b", p),
};

// --- accounting statements --------------------------------------------------

export const statementsApi = {
  /** Profit & loss from the general ledger. Note the param names: from / to. */
  profitLoss: (p?: { from?: string; to?: string }) =>
    getOne<Record<string, unknown>>("/accounting/profit-loss", "profitAndLoss", { ...p }),
  balanceSheet: (p?: { date?: string }) =>
    getOne<Record<string, unknown>>("/accounting/balance-sheet", "balanceSheet", { ...p }),
};

// --- raw escape hatch -------------------------------------------------------

/**
 * For an endpoint whose response key is not known ahead of time. Returns the
 * whole `data` object. Prefer a typed function above.
 */
export async function getData<T = Record<string, unknown>>(
  url: string,
  params?: Record<string, unknown>,
): Promise<T> {
  const res = await apiClient.get<{ data: T }>(url, { params });
  return res.data.data;
}
