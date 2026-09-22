import { apiClient } from "./client";
import { CompanySettings, ApiSuccessResponse } from "@/types/api";

export interface UpdateCompanySettingsPayload {
  currency?: string;
  timezone?: string;
  dateFormat?: string;
  invoicePrefix?: string;
  purchasePrefix?: string;
  financialYearStartMonth?: number;
  requireOpenPeriod?: boolean;
}

export const settingsApi = {
  getSettings: async (): Promise<CompanySettings> => {
    const res = await apiClient.get<
      ApiSuccessResponse<{ settings: CompanySettings }>
    >("/company-settings");
    return res.data.data.settings;
  },

  updateSettings: async (
    payload: UpdateCompanySettingsPayload
  ): Promise<CompanySettings> => {
    const res = await apiClient.patch<
      ApiSuccessResponse<{ settings: CompanySettings }>
    >("/company-settings", payload);
    return res.data.data.settings;
  },
};
