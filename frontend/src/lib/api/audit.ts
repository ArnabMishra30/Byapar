import { apiClient } from "./client";
import { AuditLogEntry, ApiSuccessResponse, Pagination } from "@/types/api";

export interface ListAuditLogsParams {
  page?: number;
  limit?: number;
  search?: string;
  action?: string;
  userId?: string;
  fromDate?: string;
  toDate?: string;
}

export interface ListAuditLogsResult {
  logs: AuditLogEntry[];
  pagination: Pagination;
}

export const auditApi = {
  listAuditLogs: async (params?: ListAuditLogsParams): Promise<ListAuditLogsResult> => {
    // NOTE: the backend has no audit-log module today, so this returns a 404 and
    // the page shows its "not available" state.
    //
    // This function previously CAUGHT that 404 and returned four hand-written
    // records - a settings change, a user creation, a login, each with an invented
    // timestamp, IP and user agent. That is worse than having no audit log at all:
    // it is evidence of events that never happened, in a product whose whole
    // purpose is keeping books that can be trusted. It has been removed.
    //
    // The error propagates deliberately. When an audit module is added to the
    // backend, this call starts working with no change here.
    const res = await apiClient.get<ApiSuccessResponse<ListAuditLogsResult>>(
      "/audit-logs",
      { params }
    );
    return res.data.data;
  },
};
