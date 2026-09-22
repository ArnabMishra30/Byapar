"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useRouter, usePathname } from "next/navigation";
import { authApi, companyApi, gstApi, getStoredToken, ApiError } from "@/lib/api";
import { isPlatformRole } from "./roles";
import { APP_CONFIG } from "@/lib/constants";
import { can, type Capability } from "@/lib/permissions";
import type { Company, GstProfile, User } from "@/types/api";

interface AuthContextValue {
  user: User | null;
  company: Company | null;
  gstProfile: GstProfile | null;

  /** True once the session has been checked against the server. */
  isReady: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;

  /**
   * Whether this company uses GST, taken from the backend's own answer.
   * Never hard-coded, and false is a perfectly normal state - a local shop with
   * no registration is a first-class user of this application.
   */
  isGstEnabled: boolean;

  /** UX-only permission check. The backend is the security boundary. */
  can: (capability: Capability) => boolean;

  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [gstProfile, setGstProfile] = useState<GstProfile | null>(null);
  const [isReady, setIsReady] = useState(false);

  const router = useRouter();
  const pathname = usePathname();

  const clear = useCallback(() => {
    setUser(null);
    setCompany(null);
    setGstProfile(null);
  }, []);

  /**
   * Establishes the session from whatever token is in storage.
   *
   * The token alone proves nothing, so the server is asked who it belongs to.
   * An expired or revoked token fails here with a 401 and the user is signed
   * out - which is what makes "refresh the page" safe.
   *
   * The company and GST profile are loaded in the same breath because both are
   * context every screen needs, and neither is chosen by the client.
   */
  const loadSession = useCallback(async () => {
    if (!getStoredToken()) {
      clear();
      setIsReady(true);
      return;
    }

    try {
      const currentUser = await authApi.me();
      setUser(currentUser);

      // These two are context, not the session itself. If either fails the user
      // is still signed in, so the failure is tolerated rather than fatal.
      const [companyResult, gstResult] = await Promise.allSettled([
        companyApi.getCurrent(),
        gstApi.getProfile(),
      ]);

      setCompany(companyResult.status === "fulfilled" ? companyResult.value : null);
      setGstProfile(gstResult.status === "fulfilled" ? gstResult.value : null);
    } catch (error) {
      // A 401 has already cleared the token inside the API client.
      if (!(error instanceof ApiError) || error.isUnauthorized) {
        clear();
      } else {
        // The server is unreachable rather than rejecting us. Staying signed out
        // is the safe answer; the login screen will say the server is down.
        clear();
      }
    } finally {
      setIsReady(true);
    }
  }, [clear]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  /**
   * A 401 from ANY request signs the user out.
   *
   * The API client dispatches this rather than navigating with
   * window.location, so the move to /login goes through the router: React state
   * survives, and the page they were on is preserved as a redirect target.
   */
  useEffect(() => {
    const onUnauthorized = () => {
      clear();
      setIsReady(true);
      if (pathname && !pathname.startsWith("/shop/login")) {
        router.replace(`/login?redirect=${encodeURIComponent(pathname)}`);
      }
    };

    window.addEventListener(APP_CONFIG.unauthorizedEvent, onUnauthorized);
    return () =>
      window.removeEventListener(APP_CONFIG.unauthorizedEvent, onUnauthorized);
  }, [clear, pathname, router]);

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await authApi.login({ email, password });

      // A PLATFORM account has no company, so every screen in this application
      // would be empty or broken for them. Turning them away here, with a clear
      // message, is far kinder than letting them in to a dashboard of zeroes -
      // and it keeps the two audiences visibly separate, which is the whole
      // point of running the shop app and the platform console apart.
      //
      // This is a COURTESY, not a security control: the backend already refuses
      // them every shop route, and refuses shop users every platform route.
      if (isPlatformRole(result.user.role)) {
        authApi.logout();
        throw new Error(
          'This is a platform account, not a shop account. Sign in to the platform console instead.',
        );
      }

      setUser(result.user);

      const [companyResult, gstResult] = await Promise.allSettled([
        companyApi.getCurrent(),
        gstApi.getProfile(),
      ]);
      setCompany(companyResult.status === "fulfilled" ? companyResult.value : null);
      setGstProfile(gstResult.status === "fulfilled" ? gstResult.value : null);
      setIsReady(true);
    },
    [],
  );

  const logout = useCallback(() => {
    authApi.logout();
    clear();
    router.replace("/shop/login");
  }, [clear, router]);

  const role = user?.role;

  const value: AuthContextValue = {
    user,
    company,
    gstProfile,
    isReady,
    isAuthenticated: Boolean(user),
    isAdmin: role === "ADMIN",
    // The backend computes this; we only read it.
    isGstEnabled: Boolean(gstProfile?.gstEnabled),
    can: (capability: Capability) => can(role, capability),
    login,
    logout,
    refresh: loadSession,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside an AuthProvider");
  }
  return context;
}
