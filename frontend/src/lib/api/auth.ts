import { apiClient } from "./client";
import { User, ApiSuccessResponse } from "@/types/api";

export interface LoginPayload {
  email: string;
  password: string;
}

export interface LoginResult {
  token: string;
  user: User;
}

export const authApi = {
  login: async (payload: LoginPayload): Promise<LoginResult> => {
    const res = await apiClient.post<ApiSuccessResponse<LoginResult>>(
      "/auth/login",
      payload
    );
    return res.data.data;
  },

  getMe: async (): Promise<User> => {
    const res = await apiClient.get<ApiSuccessResponse<{ user: User }>>(
      "/auth/me"
    );
    return res.data.data.user;
  },
};
