import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from "axios";
import { APP_CONFIG } from "../constants";

declare module "axios" {
  interface AxiosRequestConfig {
    /** On a final 401, reject quietly instead of redirecting to the login page. */
    silentUnauthorized?: boolean;
    /** Set internally once a request has been retried after a refresh. */
    _retriedAfterRefresh?: boolean;
  }
}

export const apiClient: AxiosInstance = axios.create({
  baseURL: APP_CONFIG.apiUrl,
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
  },
});

// THE SESSION IS NOT HERE. The backend keeps it in httpOnly cookies that no
// script on this page can read; the browser attaches them itself (same origin,
// via the /api/v1 proxy). This side keeps only a hint that a session probably
// exists, so the login page does not have to ask the server.

export function hasSessionHint(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(APP_CONFIG.sessionHintKey) === "1";
  } catch {
    return true; // storage disabled: check with the server to be safe
  }
}

export function setSessionHint(signedIn: boolean) {
  if (typeof window === "undefined") return;
  try {
    if (signedIn) localStorage.setItem(APP_CONFIG.sessionHintKey, "1");
    else localStorage.removeItem(APP_CONFIG.sessionHintKey);
    // The bearer token that used to live here. Gone for good.
    for (const key of APP_CONFIG.legacyKeys) localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** These establish or end the session; a 401 from them is an answer, not an expiry. */
const SESSION_ENDPOINTS = ["/auth/login", "/auth/refresh", "/auth/logout"];

/** One refresh at a time, shared by every request that hit the same expiry. */
let refreshInFlight: Promise<boolean> | null = null;

function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = axios
      .post(`${APP_CONFIG.apiUrl}/auth/refresh`, null, { timeout: 15000 })
      .then(
        () => true,
        () => false,
      )
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    // A production build without a backend URL. Say so, rather than sending the
    // request and reporting a vague 404.
    if (!APP_CONFIG.apiConfigured) {
      return Promise.reject(
        new Error("This console is not connected to the server yet. Set API_URL and redeploy."),
      );
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Standardize error handling. On a 401, renew the session once and retry; only
// if that fails is the user sent to the login page.
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<{ message?: string; error?: string; errors?: any }>) => {
    const status = error.response?.status;
    const config = error.config;
    const message =
      error.response?.data?.message ||
      error.response?.data?.error ||
      error.message ||
      "An unexpected error occurred. Please try again.";

    if (status === 401 && config) {
      const isSessionEndpoint = SESSION_ENDPOINTS.some((path) => config.url?.endsWith(path));

      if (!isSessionEndpoint && !config._retriedAfterRefresh && (await refreshSession())) {
        return apiClient({ ...config, _retriedAfterRefresh: true });
      }

      if (!isSessionEndpoint) {
        setSessionHint(false);
        if (
          !config.silentUnauthorized &&
          typeof window !== "undefined" &&
          !window.location.pathname.includes("/admin/login")
        ) {
          window.location.href = `/admin/login?redirect=${encodeURIComponent(
            window.location.pathname
          )}`;
        }
      }
    }

    const enhancedError = new Error(message);
    (enhancedError as any).status = status;
    (enhancedError as any).details = error.response?.data?.errors;
    return Promise.reject(enhancedError);
  }
);
