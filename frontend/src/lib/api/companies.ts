import { apiClient } from "./client";
import { Company, ApiSuccessResponse, User } from "@/types/api";

export interface CreateCompanyPayload {
  name: string;
  gstin?: string;
  admin: {
    name: string;
    email: string;
    password: string;
  };
}

export interface UpdateCompanyPayload {
  name?: string;
  gstin?: string | null;
  legalName?: string | null;
  stateCode?: string | null;
  registeredAddress?: string | null;
  gstRegistrationType?: string;
  isActive?: boolean;
}

export const companyApi = {
  getCurrentCompany: async (): Promise<Company> => {
    const res = await apiClient.get<ApiSuccessResponse<{ company: Company }>>(
      "/companies/me"
    );
    return res.data.data.company;
  },

  getCompanyById: async (id: string): Promise<Company> => {
    const res = await apiClient.get<ApiSuccessResponse<{ company: Company }>>(
      `/companies/${id}`
    );
    return res.data.data.company;
  },

  createCompany: async (
    payload: CreateCompanyPayload
  ): Promise<{ company: Company; admin: User }> => {
    const res = await apiClient.post<
      ApiSuccessResponse<{ company: Company; admin: User }>
    >("/companies", payload);
    return res.data.data;
  },

  updateCompany: async (
    id: string,
    payload: UpdateCompanyPayload
  ): Promise<Company> => {
    const res = await apiClient.patch<
      ApiSuccessResponse<{ company: Company }>
    >(`/companies/${id}`, payload);
    return res.data.data.company;
  },
};
