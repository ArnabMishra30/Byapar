import { apiClient } from "./client";
import { ApiSuccessResponse } from "@/types/api";

export interface DashboardQueryParams {
  period?: "today" | "this_month" | "last_month" | "this_quarter" | "this_financial_year" | "custom";
  from?: string;
  to?: string;
}

export interface DashboardData {
  period: {
    from: string;
    to: string;
    label?: string;
  };
  sales: {
    grossSales: string | number;
    salesReturns: string | number;
    netSales: string | number;
    invoiceCount: number;
  };
  purchases: {
    grossPurchases: string | number;
    purchaseReturns: string | number;
    netPurchases: string | number;
    billCount: number;
  };
  moneyMovement: {
    moneyReceived: string | number;
    moneyPaid: string | number;
    netMovement: string | number;
  };
  creditSummary?: {
    customerReceivables: string | number;
    supplierPayables: string | number;
    netCredit: string | number;
  };
  recentActivity?: Array<{
    id: string;
    type: string;
    number: string;
    partyName: string;
    amount: string | number;
    date: string;
    status: string;
  }>;
}

export interface CreditSummaryData {
  receivables: {
    totalOutstanding: string | number;
    totalParties: number;
    overdueAmount?: string | number;
  };
  payables: {
    totalOutstanding: string | number;
    totalParties: number;
    overdueAmount?: string | number;
  };
  netPosition: string | number;
}

export const dashboardApi = {
  getDashboard: async (params?: DashboardQueryParams): Promise<DashboardData> => {
    const res = await apiClient.get<ApiSuccessResponse<DashboardData>>(
      "/dashboard",
      { params }
    );
    return res.data.data;
  },

  getCreditSummary: async (): Promise<CreditSummaryData> => {
    const res = await apiClient.get<ApiSuccessResponse<CreditSummaryData>>(
      "/credit"
    );
    return res.data.data;
  },
};
