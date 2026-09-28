import { apiClient, setSessionHint } from "./client";
import { User, ApiSuccessResponse } from "@/types/api";

export interface LoginPayload {
  email: string;
  password: string;
}

export interface LoginResult {
  user: User;
}

// The backend issues the session as httpOnly cookies. No token passes through
// this code.
export const authApi = {
  login: async (payload: LoginPayload): Promise<LoginResult> => {
    const res = await apiClient.post<ApiSuccessResponse<LoginResult>>(
      "/auth/login",
      payload
    );
    setSessionHint(true);
    return res.data.data;
  },

  /** `silent`: a 401 is a normal answer (first load), not a reason to redirect. */
  getMe: async ({ silent = false }: { silent?: boolean } = {}): Promise<User> => {
    const res = await apiClient.get<ApiSuccessResponse<{ user: User }>>(
      "/auth/me",
      { silentUnauthorized: silent }
    );
    return res.data.data.user;
  },

  /** Revokes the session on the server and clears its cookies. */
  logout: async (): Promise<void> => {
    setSessionHint(false);
    try {
      await apiClient.post("/auth/logout");
    } catch {
      /* already signed out locally; the refresh token expires on its own */
    }
  },
};
