import { getList, getOne, postOne, patchOne, type ListParams } from "./http";
import type { Customer, Supplier, Product, Warehouse, Category, Unit, Tax } from "@/types/api";

/** Master data: the things documents are built out of. */

export const customersApi = {
  list: (p?: ListParams) => getList<Customer>("/customers", p),
  get: (id: string) => getOne<Customer>(`/customers/${id}`, "customer"),
  create: (body: Partial<Customer>) => postOne<Customer>("/customers", "customer", body),
  update: (id: string, body: Partial<Customer>) =>
    patchOne<Customer>(`/customers/${id}`, "customer", body),
  setStatus: (id: string, isActive: boolean) =>
    patchOne<Customer>(`/customers/${id}/status`, "customer", { isActive }),

  /** What this customer owes, and the bills behind it. */
  outstanding: (id: string) => getOne<Record<string, unknown>>(`/customers/${id}/outstanding`, "outstanding"),
  ledger: (id: string, p?: { fromDate?: string; toDate?: string }) =>
    getOne<Record<string, unknown>>(`/customers/${id}/ledger`, "ledger", p),
  statement: (id: string, p?: { fromDate?: string; toDate?: string }) =>
    getOne<Record<string, unknown>>(`/customers/${id}/statement`, "statement", p),
  credit: (id: string) => getOne<Record<string, unknown>>(`/customers/${id}/credit`, "credit"),
  receivables: (id: string) => getOne<unknown[]>(`/customers/${id}/receivables`, "receivables"),
};

export const suppliersApi = {
  list: (p?: ListParams) => getList<Supplier>("/suppliers", p),
  get: (id: string) => getOne<Supplier>(`/suppliers/${id}`, "supplier"),
  create: (body: Partial<Supplier>) => postOne<Supplier>("/suppliers", "supplier", body),
  update: (id: string, body: Partial<Supplier>) =>
    patchOne<Supplier>(`/suppliers/${id}`, "supplier", body),
  setStatus: (id: string, isActive: boolean) =>
    patchOne<Supplier>(`/suppliers/${id}/status`, "supplier", { isActive }),

  outstanding: (id: string) => getOne<Record<string, unknown>>(`/suppliers/${id}/outstanding`, "outstanding"),
  ledger: (id: string, p?: { fromDate?: string; toDate?: string }) =>
    getOne<Record<string, unknown>>(`/suppliers/${id}/ledger`, "ledger", p),
  statement: (id: string, p?: { fromDate?: string; toDate?: string }) =>
    getOne<Record<string, unknown>>(`/suppliers/${id}/statement`, "statement", p),
  payables: (id: string) => getOne<unknown[]>(`/suppliers/${id}/payables`, "payables"),
};

export const productsApi = {
  list: (p?: ListParams) => getList<Product>("/products", p),
  get: (id: string) => getOne<Product>(`/products/${id}`, "product"),
  create: (body: Partial<Product>) => postOne<Product>("/products", "product", body),
  update: (id: string, body: Partial<Product>) =>
    patchOne<Product>(`/products/${id}`, "product", body),
  setStatus: (id: string, isActive: boolean) =>
    patchOne<Product>(`/products/${id}/status`, "product", { isActive }),
};

export const warehousesApi = {
  list: (p?: ListParams) => getList<Warehouse>("/warehouses", p),
  create: (body: Partial<Warehouse>) => postOne<Warehouse>("/warehouses", "warehouse", body),
};

export const categoriesApi = {
  list: (p?: ListParams) => getList<Category>("/categories", p),
  create: (body: Partial<Category>) => postOne<Category>("/categories", "category", body),
};

export const unitsApi = {
  list: (p?: ListParams) => getList<Unit>("/units", p),
  create: (body: Partial<Unit>) => postOne<Unit>("/units", "unit", body),
};

export const taxesApi = {
  list: (p?: ListParams) => getList<Tax>("/taxes", p),
};
