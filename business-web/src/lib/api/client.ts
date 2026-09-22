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

// The token lives in localStorage, which is only reachable in the browser.
export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(APP_CONFIG.tokenKey);
  } catch {
    // Private mode, or storage disabled. Treated as "not signed in".
    return null;
  }
}

export function setStoredToken(token: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(APP_CONFIG.tokenKey, token);
  } catch {
    /* nothing we can do; the session simply will not survive a reload */
  }
}

export function clearStoredToken() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(APP_CONFIG.tokenKey);
  } catch {
    /* ignore */
  }
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
    const token = getStoredToken();
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

/**
 * Turns every failure into an ApiError, and signs the user out on a 401.
 *
 * The redirect is deliberately NOT done here with window.location. A hard
 * navigation throws away React state and any half-typed form. Instead the token
 * is cleared and an event is dispatched; the auth provider listens and moves the
 * user to /login through the router, preserving where they were trying to go.
 */
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiErrorResponse>) => {
    // Already normalised (the request interceptor refused to send it).
    if ((error as unknown) instanceof ApiError) return Promise.reject(error);

    const status = error.response?.status ?? 0;
    const body = error.response?.data;

    if (status === 401) {
      clearStoredToken();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(APP_CONFIG.unauthorizedEvent));
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
