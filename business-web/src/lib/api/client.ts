import axios, {
  AxiosError,
  AxiosInstance,
  InternalAxiosRequestConfig,
} from "axios";
import { APP_CONFIG } from "@/lib/constants";
import type { ApiErrorResponse } from "@/types/api";

/**
 * The ONE place Business Web talks to the network.
 *
 * Nothing in this application calls `fetch` directly. Every request goes through
 * here, which is what makes the auth header, the error shape and the 401
 * handling uniform - and what would let a mobile client reuse the same backend
 * later by reimplementing only this file.
 *
 * There is no Next.js API route, no database access and no business logic on
 * this side. The Express backend is the only backend:
 *
 *   Business Web -> Express -> services -> repositories -> Prisma -> PostgreSQL
 */
export const apiClient: AxiosInstance = axios.create({
  baseURL: APP_CONFIG.apiUrl,
  timeout: 30000,
  headers: { "Content-Type": "application/json" },
});

/** A network/HTTP failure, normalised so every caller can rely on the shape. */
export class ApiError extends Error {
  /** HTTP status, or 0 when the request never reached the server. */
  readonly status: number;
  /** The backend's stable machine-readable code, e.g. CREDIT_LIMIT_EXCEEDED. */
  readonly code?: string;
  /** Field-level validation errors, for feeding straight back into a form. */
  readonly fieldErrors?: { field: string; message: string }[];

  constructor(
    message: string,
    status: number,
    code?: string,
    fieldErrors?: { field: string; message: string }[],
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }

  get isUnauthorized() {
    return this.status === 401;
  }
  get isForbidden() {
    return this.status === 403;
  }
  get isNotFound() {
    return this.status === 404;
  }
  /** A rule the business broke - a closed period, a credit limit, bad input. */
  get isBusinessRule() {
    return this.status === 422 || this.status === 409;
  }
  get isOffline() {
    return this.status === 0;
  }
}

declare module "axios" {
  interface AxiosRequestConfig {
    /** On a final 401, reject quietly instead of signing the user out. */
    silentUnauthorized?: boolean;
    /** Set internally once a request has been retried after a refresh. */
    _retriedAfterRefresh?: boolean;
  }
}

// THE SESSION IS NOT HERE.
//
// The backend keeps it in httpOnly cookies: a short-lived access token sent with
// every call, and a refresh token sent only to /auth/refresh. No script on this
// page - ours or an injected one - can read either. What this side keeps is a
// HINT that a session probably exists, so a visitor to the landing page is not
// made to ask the server "am I signed in?" on every page view.

export function hasSessionHint(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(APP_CONFIG.sessionHintKey) === "1";
  } catch {
    // Private mode, or storage disabled: check with the server to be safe.
    return true;
  }
}

export function setSessionHint(signedIn: boolean) {
  if (typeof window === "undefined") return;
  try {
    if (signedIn) window.localStorage.setItem(APP_CONFIG.sessionHintKey, "1");
    else window.localStorage.removeItem(APP_CONFIG.sessionHintKey);
    // The bearer token that used to live here. Gone for good.
    window.localStorage.removeItem(APP_CONFIG.legacyTokenKey);
  } catch {
    /* ignore */
  }
}

/** These establish or end the session; a 401 from them is an answer, not an expiry. */
const SESSION_ENDPOINTS = ["/auth/login", "/auth/refresh", "/auth/logout"];

/**
 * One refresh at a time. When the access token expires, every request in flight
 * gets a 401 together; they all wait on the same refresh instead of racing to
 * rotate the refresh token.
 */
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
    // A production build without NEXT_PUBLIC_API_URL. Say so, rather than
    // sending the request to this site's own origin and reporting a vague 404.
    if (!APP_CONFIG.apiConfigured) {
      return Promise.reject(
        new ApiError(
          "This site is not connected to the server yet. Please try again later.",
          0,
          "API_NOT_CONFIGURED",
        ),
      );
    }
    // The session cookies are attached by the browser: same origin, httpOnly.
    return config;
  },
  (error) => Promise.reject(error),
);

/**
 * Turns every failure into an ApiError. On a 401 it first tries to renew the
 * session once, then retries the request; only if that fails is the user
 * signed out.
 *
 * The redirect is deliberately NOT done here with window.location. A hard
 * navigation throws away React state and any half-typed form. Instead an event
 * is dispatched; the auth provider listens and moves the user to /login through
 * the router, preserving where they were trying to go.
 */
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorResponse>) => {
    // Already normalised (the request interceptor refused to send it).
    if ((error as unknown) instanceof ApiError) return Promise.reject(error);

    const status = error.response?.status ?? 0;
    const body = error.response?.data;
    const config = error.config;

    if (status === 401 && config) {
      const isSessionEndpoint = SESSION_ENDPOINTS.some((path) => config.url?.endsWith(path));

      if (!isSessionEndpoint && !config._retriedAfterRefresh && (await refreshSession())) {
        return apiClient({ ...config, _retriedAfterRefresh: true });
      }

      if (!isSessionEndpoint) {
        setSessionHint(false);
        if (!config.silentUnauthorized && typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent(APP_CONFIG.unauthorizedEvent));
        }
      }
    }

    const message =
      body?.message ||
      (status === 0
        ? "Could not reach the server. Check your connection and try again."
        : "Something went wrong. Please try again.");

    return Promise.reject(
      new ApiError(message, status, body?.code, body?.errors),
    );
  },
);

/** Strips undefined so axios never sends `?search=undefined`. */
export function cleanParams<T extends Record<string, unknown>>(
  params?: T,
): Record<string, unknown> | undefined {
  if (!params) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
