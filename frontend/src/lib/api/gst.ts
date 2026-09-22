import { apiClient } from "./client";
import { ApiSuccessResponse } from "@/types/api";

export interface GstProfile {
  isGstEnabled: boolean;
  gstin?: string | null;
  legalName?: string | null;
  stateCode?: string | null;
  stateName?: string | null;
  gstRegistrationType: string;
}

export interface UpdateGstProfilePayload {
  gstin?: string | null;
  legalName?: string | null;
  stateCode?: string | null;
  gstRegistrationType?: string;
}

export interface ValidateGstinResult {
  valid: boolean;
  stateCode?: string;
  stateName?: string;
  pan?: string;
  entityNumber?: string;
  checksum?: string;
  message?: string;
}

export const gstApi = {
  getProfile: async (): Promise<GstProfile> => {
    const res = await apiClient.get<ApiSuccessResponse<GstProfile>>(
      "/tax/profile"
    );
    return res.data.data;
  },

  updateProfile: async (payload: UpdateGstProfilePayload): Promise<GstProfile> => {
    const res = await apiClient.patch<ApiSuccessResponse<GstProfile>>(
      "/tax/profile",
      payload
    );
    return res.data.data;
  },

  validateGstin: async (gstin: string): Promise<ValidateGstinResult> => {
    const res = await apiClient.post<ApiSuccessResponse<ValidateGstinResult>>(
      "/tax/validate-gstin",
      { gstin }
    );
    return res.data.data;
  },

  listStates: async (): Promise<Array<{ code: string; name: string }>> => {
    const res = await apiClient.get<
      ApiSuccessResponse<{ states: Array<{ code: string; name: string }> }>
    >("/tax/states");
    return res.data.data.states;
  },

  listClassifications: async (params?: { search?: string; kind?: string }): Promise<any[]> => {
    const res = await apiClient.get<ApiSuccessResponse<{ classifications: any[] }>>(
      "/tax/classifications",
      { params }
    );
    return res.data.data.classifications;
  },
};
