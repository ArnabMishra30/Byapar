import { apiClient, setSessionHint } from "./client";
import type { ApiSuccessResponse, User } from "@/types/api";

export interface LoginPayload {
  email: string;
  password: string;
}

export interface LoginResult {
  user: User;
}

/**
 * Authentication against the EXISTING Express backend.
 *
 * There is no auth backend on this side and there must never be one - no Next.js
 * API route, no session table, no second user store. The backend issues the
 * session as httpOnly cookies; this code never sees a token.
 */
export const authApi = {
  login: async (payload: LoginPayload): Promise<LoginResult> => {
    const res = await apiClient.post<ApiSuccessResponse<LoginResult>>(
      "/auth/login",
      payload,
    );
    setSessionHint(true);
    return res.data.data;
  },

  /**
   * The current user, re-read from the server.
   *
   * This is what makes a page refresh safe: the browser presents its session
   * cookie and the backend says whose it is. An expired access token is renewed
   * by the API client; a dead session gets a 401 here.
   *
   * `silent` checks without signing anybody out - used on first load, where
   * "no session" is a normal answer, not an interruption.
   */
  me: async ({ silent = false }: { silent?: boolean } = {}): Promise<User> => {
    const res = await apiClient.get<ApiSuccessResponse<{ user: User }>>("/auth/me", {
      silentUnauthorized: silent,
    });
    return res.data.data.user;
  },

  /**
   * Sign out. The backend revokes the refresh token, so the session is over on
   * the server too - not just forgotten by this tab - and clears the cookies.
   * Signing out locally still happens if the server cannot be reached.
   */
  logout: async (): Promise<void> => {
    setSessionHint(false);
    try {
      await apiClient.post("/auth/logout");
    } catch {
      /* already signed out locally; the refresh token expires on its own */
    }
  },
};
