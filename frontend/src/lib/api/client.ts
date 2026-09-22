import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from "axios";
import { APP_CONFIG } from "../constants";

export const apiClient: AxiosInstance = axios.create({
  baseURL: APP_CONFIG.apiUrl,
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
  },
});

// Attach Authorization Bearer token from localStorage
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    // A production build without NEXT_PUBLIC_API_URL. Say so, rather than
    // sending the request to this site's own origin and reporting a vague 404.
    if (!APP_CONFIG.apiConfigured) {
      return Promise.reject(
        new Error("This console is not connected to the server yet. Set NEXT_PUBLIC_API_URL and redeploy."),
      );
    }
    if (typeof window !== "undefined") {
      const token = localStorage.getItem(APP_CONFIG.tokenKey);
      if (token && config.headers) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Standardize error handling and handle 401 unauthenticated
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ message?: string; error?: string; errors?: any }>) => {
    const status = error.response?.status;
    const message =
      error.response?.data?.message ||
      error.response?.data?.error ||
      error.message ||
      "An unexpected error occurred. Please try again.";

    if (status === 401 && typeof window !== "undefined") {
      // Clear token and broadcast logout if not already on login page
      if (!window.location.pathname.includes("/admin/login")) {
        localStorage.removeItem(APP_CONFIG.tokenKey);
        window.location.href = `/admin/login?redirect=${encodeURIComponent(
          window.location.pathname
        )}`;
      }
    }

    const enhancedError = new Error(message);
    (enhancedError as any).status = status;
    (enhancedError as any).details = error.response?.data?.errors;
    return Promise.reject(enhancedError);
  }
);
