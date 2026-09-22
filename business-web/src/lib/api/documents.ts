import { getList, getOne, postOne, patchOne, type ListParams } from "./http";
import type { SalesInvoice, Purchase, Expense } from "@/types/api";

/**
 * The three documents a shop creates all day, and their identical lifecycle:
 *
 *   create draft -> edit draft -> POST (hits the books) -> immutable
 *
 * Posting is where stock moves and the ledger changes, which is why it is a
 * separate call and why only an admin may make it.
 */

export const salesApi = {
  list: (p?: ListParams) => getList<SalesInvoice>("/sales", p),
  get: (id: string) => getOne<SalesInvoice>(`/sales/${id}`, "sale"),
  create: (body: unknown) => postOne<SalesInvoice>("/sales", "sale", body),
  update: (id: string, body: unknown) => patchOne<SalesInvoice>(`/sales/${id}`, "sale", body),
  /** Commits the invoice: stock out, receivable raised, journal written. */
  post: (id: string, body?: { creditLimitOverride?: boolean; creditLimitOverrideReason?: string }) =>
    postOne<SalesInvoice>(`/sales/${id}/post`, "sale", body),
  cancel: (id: string) => postOne<SalesInvoice>(`/sales/${id}/cancel`, "sale"),
};

export const salesReturnsApi = {
  list: (p?: ListParams) => getList<Record<string, unknown>>("/sales-returns", p),
  get: (id: string) => getOne<Record<string, unknown>>(`/sales-returns/${id}`, "salesReturn"),
  create: (body: unknown) => postOne<Record<string, unknown>>("/sales-returns", "salesReturn", body),
  post: (id: string) => postOne<Record<string, unknown>>(`/sales-returns/${id}/post`, "salesReturn"),
};

export const purchasesApi = {
  list: (p?: ListParams) => getList<Purchase>("/purchases", p),
  get: (id: string) => getOne<Purchase>(`/purchases/${id}`, "purchase"),
  create: (body: unknown) => postOne<Purchase>("/purchases", "purchase", body),
  update: (id: string, body: unknown) => patchOne<Purchase>(`/purchases/${id}`, "purchase", body),
  post: (id: string) => postOne<Purchase>(`/purchases/${id}/post`, "purchase"),
  cancel: (id: string) => postOne<Purchase>(`/purchases/${id}/cancel`, "purchase"),
};

export const purchaseReturnsApi = {
  list: (p?: ListParams) => getList<Record<string, unknown>>("/purchase-returns", p),
  create: (body: unknown) => postOne<Record<string, unknown>>("/purchase-returns", "purchaseReturn", body),
  post: (id: string) => postOne<Record<string, unknown>>(`/purchase-returns/${id}/post`, "purchaseReturn"),
};

export const expensesApi = {
  list: (p?: ListParams) => getList<Expense>("/expenses", p),
  get: (id: string) => getOne<Expense>(`/expenses/${id}`, "expense"),
  create: (body: unknown) => postOne<Expense>("/expenses", "expense", body),
  update: (id: string, body: unknown) => patchOne<Expense>(`/expenses/${id}`, "expense", body),
  post: (id: string) => postOne<Expense>(`/expenses/${id}/post`, "expense"),
  cancel: (id: string) => postOne<Expense>(`/expenses/${id}/cancel`, "expense"),
  /** A posted expense is never edited; it is undone by an opposite entry. */
  reverse: (id: string) => postOne<Expense>(`/expenses/${id}/reverse`, "expense"),
  /** Categories ARE expense accounts in the chart. No separate master. */
  categories: () => getOne<{ accountId: string; code: string; name: string; isSystem: boolean }[]>(
    "/expenses/categories",
    "categories",
  ),
};
