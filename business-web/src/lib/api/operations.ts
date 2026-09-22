import { getList, getOne, postOne, type ListParams } from "./http";
import type { StockBalance, StockMovement } from "@/types/api";

export const inventoryApi = {
  balances: (p?: ListParams) => getList<StockBalance>("/inventory", p),
  movements: (p?: ListParams) => getList<StockMovement>("/inventory/movements", p),
  openingStock: (body: unknown) => postOne<StockMovement>("/inventory/opening-stock", "movement", body),
  adjust: (body: unknown) => postOne<StockMovement>("/inventory/adjustments", "movement", body),
};

/** The credit book, and the collection/payment chase lists on top of it. */
export const creditApi = {
  book: (p?: { asOfDate?: string }) => getOne<Record<string, unknown>>("/credit", "credit", p),
  receivables: (p?: { asOfDate?: string; overdueOnly?: string; minimumAmount?: string }) =>
    getOne<Record<string, unknown>>("/credit/receivables", "receivables", p),
  payables: (p?: { asOfDate?: string; overdueOnly?: string; minimumAmount?: string }) =>
    getOne<Record<string, unknown>>("/credit/payables", "payables", p),
  collections: (p?: { asOfDate?: string; dueWithinDays?: number }) =>
    getOne<Record<string, unknown>>("/credit/collections", "collections", p),
  payablesSummary: (p?: { asOfDate?: string }) =>
    getOne<Record<string, unknown>>("/credit/payables-summary", "payables", p),
  exposure: () => getOne<Record<string, unknown>>("/credit/exposure", "exposure"),
};

export interface DateRange {
  fromDate?: string;
  toDate?: string;
  [key: string]: unknown;
}

/** Every report the backend actually publishes. Nothing invented. */
export const reportsApi = {
  sales: (p?: DateRange & ListParams) => getOne<Record<string, unknown>>("/reports/sales", "report", p),
  purchases: (p?: DateRange & ListParams) => getOne<Record<string, unknown>>("/reports/purchases", "report", p),
  expenses: (p?: DateRange) => getOne<Record<string, unknown>>("/reports/expenses", "report", p),
  profitLoss: (p?: DateRange) => getOne<Record<string, unknown>>("/reports/profit-loss", "report", p),
  cashBank: (p?: DateRange & ListParams) => getOne<Record<string, unknown>>("/reports/cash-bank", "report", p),
  inventoryValuation: (p?: { lowStockOnly?: string }) =>
    getOne<Record<string, unknown>>("/reports/inventory-valuation", "report", p),
  customerOutstanding: (p?: { asOfDate?: string }) =>
    getOne<Record<string, unknown>>("/reports/customer-outstanding", "report", p),
  supplierOutstanding: (p?: { asOfDate?: string }) =>
    getOne<Record<string, unknown>>("/reports/supplier-outstanding", "report", p),
  paymentsReceived: (p?: DateRange & ListParams) =>
    getOne<Record<string, unknown>>("/reports/payments-received", "report", p),
  supplierPayments: (p?: DateRange & ListParams) =>
    getOne<Record<string, unknown>>("/reports/supplier-payments", "report", p),
  generalLedger: (p?: DateRange & ListParams & { accountId?: string }) =>
    getList<Record<string, unknown>>("/reports/general-ledger", p),
};

export const accountingApi = {
  accounts: (p?: ListParams) => getList<Record<string, unknown>>("/accounts", p),
  account: (id: string) => getOne<Record<string, unknown>>(`/accounts/${id}`, "account"),
  accountLedger: (id: string, p?: DateRange & ListParams) =>
    getOne<Record<string, unknown>>(`/accounts/${id}/ledger`, "ledger", p),
  journal: (p?: ListParams & DateRange) => getList<Record<string, unknown>>("/journal-entries", p),
  journalEntry: (id: string) => getOne<Record<string, unknown>>(`/journal-entries/${id}`, "journalEntry"),
  trialBalance: (p?: { asOfDate?: string }) =>
    getOne<Record<string, unknown>>("/accounting/trial-balance", "trialBalance", p),
  profitLoss: (p?: { dateFrom?: string; dateTo?: string }) =>
    getOne<Record<string, unknown>>("/accounting/profit-loss", "report", p),
  balanceSheet: (p?: { asOfDate?: string }) =>
    getOne<Record<string, unknown>>("/accounting/balance-sheet", "report", p),
};

export const periodsApi = {
  list: (p?: ListParams & { status?: string }) => getList<Record<string, unknown>>("/accounting-periods", p),
  get: (id: string) => getOne<Record<string, unknown>>(`/accounting-periods/${id}`, "period"),
  create: (body: { name: string; startDate: string; endDate: string }) =>
    postOne<Record<string, unknown>>("/accounting-periods", "period", body),
  close: (id: string) => postOne<Record<string, unknown>>(`/accounting-periods/${id}/close`, "period"),
  reopen: (id: string, reason?: string) =>
    postOne<Record<string, unknown>>(`/accounting-periods/${id}/reopen`, "period", reason ? { reason } : {}),
  /** "Can I post on this date?" - so a date picker can answer before a failure. */
  check: (date: string) => getOne<Record<string, unknown>>("/accounting-periods/check", "check", { date }),
};

export const openingBalancesApi = {
  status: () => getOne<Record<string, unknown>>("/opening-balances", "openingBalances"),
  details: () => getOne<Record<string, unknown>>("/opening-balances/details", "openingBalances"),
  create: (body: unknown) => postOne<Record<string, unknown>>("/opening-balances", "openingBalances", body),
};

export const staffApi = {
  list: (p?: ListParams) => getList<Record<string, unknown>>("/users", p),
  create: (body: unknown) => postOne<Record<string, unknown>>("/users", "user", body),
  update: (id: string, body: unknown) =>
    postOne<Record<string, unknown>>(`/users/${id}`, "user", body),
};
