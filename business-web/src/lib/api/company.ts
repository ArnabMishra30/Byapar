import { apiClient } from "./client";
import type {
  ApiSuccessResponse,
  Company,
  CompanySettings,
  GstProfile,
} from "@/types/api";

/**
 * COMPANY CONTEXT.
 *
 * The company is never chosen by the client. The backend derives it from the
 * JWT, and every query it runs is scoped to that company - a client-supplied
 * company id is ignored, and another company's record answers 404.
 *
 * So there is no company switcher here and there must not be one until the
 * backend grows a concept that supports it. `/companies/me` is simply "the
 * company this token belongs to".
 */
export const companyApi = {
  getCurrent: async (): Promise<Company> => {
    const res = await apiClient.get<ApiSuccessResponse<{ company: Company }>>(
      "/companies/me",
    );
    return res.data.data.company;
  },

  update: async (id: string, payload: Partial<Company>): Promise<Company> => {
    const res = await apiClient.patch<ApiSuccessResponse<{ company: Company }>>(
      `/companies/${id}`,
      payload,
    );
    return res.data.data.company;
  },

  getSettings: async (): Promise<CompanySettings> => {
    const res = await apiClient.get<
      ApiSuccessResponse<{ settings: CompanySettings }>
    >("/company-settings");
    return res.data.data.settings;
  },

  updateSettings: async (
    payload: Partial<CompanySettings>,
  ): Promise<CompanySettings> => {
    const res = await apiClient.patch<
      ApiSuccessResponse<{ settings: CompanySettings }>
    >("/company-settings", payload);
    return res.data.data.settings;
  },
};

/**
 * The authoritative answer to "does this company use GST?".
 *
 * `gstEnabled` is computed by the backend from whether a state code is
 * configured. Business Web asks; it never assumes, and it never hard-codes true.
 */
export const gstApi = {
  getProfile: async (): Promise<GstProfile> => {
    const res = await apiClient.get<ApiSuccessResponse<{ gstProfile: GstProfile }>>(
      "/tax/profile",
    );
    return res.data.data.gstProfile;
  },

  updateProfile: async (payload: {
    stateCode?: string | null;
    gstin?: string | null;
    registrationType?: string;
  }): Promise<GstProfile> => {
    const res = await apiClient.patch<
      ApiSuccessResponse<{ gstProfile: GstProfile }>
    >("/tax/profile", payload);
    return res.data.data.gstProfile;
  },
};
