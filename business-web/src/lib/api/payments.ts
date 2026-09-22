import { getList, getOne, postOne, type ListParams } from "./http";
import type { CustomerPayment, SupplierPayment, Receivable, Payable } from "@/types/api";

/**
 * Money in and money out.
 *
 * Both sides follow the same shape: a receipt or payment is created as a draft
 * with allocations against specific bills, then posted. Anything not allocated
 * is an advance and stays as credit for that party.
 */

export const receivablesApi = {
  list: (p?: ListParams) => getList<Receivable>("/customer-receivables", p),
};

export const payablesApi = {
  list: (p?: ListParams) => getList<Payable>("/supplier-payables", p),
};

export interface Allocation {
  receivableId?: string;
  payableId?: string;
  amount: string;
}

export const moneyInApi = {
  list: (p?: ListParams) => getList<CustomerPayment>("/customer-payments", p),
  get: (id: string) => getOne<CustomerPayment>(`/customer-payments/${id}`, "payment"),
  create: (body: unknown) => postOne<CustomerPayment>("/customer-payments", "payment", body),
  post: (id: string) => postOne<CustomerPayment>(`/customer-payments/${id}/post`, "payment"),
  cancel: (id: string) => postOne<CustomerPayment>(`/customer-payments/${id}/cancel`, "payment"),
};

export const moneyOutApi = {
  list: (p?: ListParams) => getList<SupplierPayment>("/supplier-payments", p),
  get: (id: string) => getOne<SupplierPayment>(`/supplier-payments/${id}`, "payment"),
  create: (body: unknown) => postOne<SupplierPayment>("/supplier-payments", "payment", body),
  post: (id: string) => postOne<SupplierPayment>(`/supplier-payments/${id}/post`, "payment"),
  cancel: (id: string) => postOne<SupplierPayment>(`/supplier-payments/${id}/cancel`, "payment"),
};
