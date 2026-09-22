import { apiClient, cleanParams } from "./client";
import type { ApiSuccessResponse, PaginatedResponse, Pagination } from "@/types/api";

/**
 * The two response shapes the backend uses, typed once.
 *
 * Lists come back as { success, data: [], pagination }. Everything else comes
 * back as { success, data: { <key>: ... } }. Rather than repeat that unwrapping
 * in fifteen modules, it lives here.
 */
export interface ListParams {
  page?: number;
  limit?: number;
  search?: string;
  [key: string]: unknown;
}

export interface ListResult<T> {
  items: T[];
  pagination: Pagination;
}

export async function getList<T>(url: string, params?: ListParams): Promise<ListResult<T>> {
  const res = await apiClient.get<PaginatedResponse<T>>(url, { params: cleanParams(params) });
  return { items: res.data.data ?? [], pagination: res.data.pagination };
}

export async function getOne<T>(url: string, key: string, params?: Record<string, unknown>): Promise<T> {
  const res = await apiClient.get<ApiSuccessResponse<Record<string, T>>>(url, {
    params: cleanParams(params),
  });
  return res.data.data[key];
}

export async function postOne<T>(url: string, key: string, body?: unknown): Promise<T> {
  const res = await apiClient.post<ApiSuccessResponse<Record<string, T>>>(url, body ?? {});
  return res.data.data[key];
}

export async function patchOne<T>(url: string, key: string, body: unknown): Promise<T> {
  const res = await apiClient.patch<ApiSuccessResponse<Record<string, T>>>(url, body);
  return res.data.data[key];
}
