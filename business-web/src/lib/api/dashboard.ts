import { apiClient, cleanParams } from "./client";
import type { ApiSuccessResponse, Dashboard } from "@/types/api";

/**
 * The dashboard.
 *
 * Every figure on the business dashboard comes from this ONE call. Nothing is
 * recomputed in React: profit, customer credit, supplier dues, cash, bank and
 * stock value are all produced by the backend from posted journal entries and
 * the sub-ledgers, and re-deriving any of them here would create a second set of
 * books that could disagree with the first.
 */
export const dashboardApi = {
  get: async (params?: { date?: string }): Promise<Dashboard> => {
    const res = await apiClient.get<ApiSuccessResponse<{ dashboard: Dashboard }>>(
      "/dashboard",
      { params: cleanParams(params) },
    );
    return res.data.data.dashboard;
  },
};
