import { apiClient, setStoredToken, clearStoredToken } from "./client";
import type { ApiSuccessResponse, User } from "@/types/api";

export interface LoginPayload {
  email: string;
  password: string;
}

export interface LoginResult {
  token: string;
  user: User;
}

/**
 * Authentication against the EXISTING Express backend.
 *
 * There is no auth backend on this side and there must never be one - no Next.js
 * API route, no session table, no second user store. The JWT the backend issues
 * is the whole session.
 */
export const authApi = {
  login: async (payload: LoginPayload): Promise<LoginResult> => {
    const res = await apiClient.post<ApiSuccessResponse<LoginResult>>(
      "/auth/login",
      payload,
    );
    const result = res.data.data;
    setStoredToken(result.token);
    return result;
  },

  /**
   * The current user, re-read from the server.
   *
   * This is what makes a page refresh safe: the token in storage is proof of
   * nothing on its own, so the app asks the backend who it belongs to and lets
   * the backend answer. An expired or revoked token gets a 401 here and the user
   * is signed out.
   */
  me: async (): Promise<User> => {
    const res = await apiClient.get<ApiSuccessResponse<{ user: User }>>("/auth/me");
    return res.data.data.user;
  },

  /**
   * Sign out.
   *
   * The backend issues stateless JWTs with no revocation list, so signing out is
   * local by definition: drop the token. Said plainly rather than pretending a
   * server call happened.
   */
  logout: () => clearStoredToken(),
};
