"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { User, Company } from "@/types/api";
import { authApi, companyApi, hasSessionHint, setSessionHint } from "@/lib/api";
import { useRouter } from "next/navigation";

interface AuthContextType {
  user: User | null;
  company: Company | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isAdmin: boolean;
  isStaff: boolean;
  isGstEnabled: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  refreshCompany: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const router = useRouter();

  const fetchSession = useCallback(async () => {
    try {
      // The session is an httpOnly cookie this code cannot see. Without the hint
      // there is none worth asking the server about.
      if (!hasSessionHint()) {
        setSessionHint(false); // also sweeps away a pre-cookie token
        setUser(null);
        setCompany(null);
        setIsLoading(false);
        return;
      }

      const currentUser = await authApi.getMe({ silent: true });
      setUser(currentUser);

      try {
        const currentCompany = await companyApi.getCurrentCompany();
        setCompany(currentCompany);
      } catch (compErr) {
        console.warn("Could not fetch active company:", compErr);
      }
    } catch (err) {
      console.warn("Session verification failed:", err);
      setUser(null);
      setCompany(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  const login = async (email: string, password: string) => {
    setIsLoading(true);
    try {
      const result = await authApi.login({ email, password });
      setUser(result.user);

      try {
        const comp = await companyApi.getCurrentCompany();
        setCompany(comp);
      } catch {
        // Continue even if company details need separate load
      }
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    setUser(null);
    setCompany(null);
    router.push("/admin/login");
    void authApi.logout();
  };

  const refreshUser = async () => {
    if (!hasSessionHint()) return;
    const refreshed = await authApi.getMe();
    setUser(refreshed);
  };

  const refreshCompany = async () => {
    if (!hasSessionHint()) return;
    const refreshedComp = await companyApi.getCurrentCompany();
    setCompany(refreshedComp);
  };

  const isAdmin = user?.role === "ADMIN";
  const isStaff = user?.role === "STAFF";
  // GST is enabled if the company has a stateCode configured and registration type is not UNREGISTERED
  const isGstEnabled = Boolean(
    company?.stateCode && company?.gstRegistrationType !== "UNREGISTERED"
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        company,
        isAuthenticated: !!user,
        isLoading,
        isAdmin,
        isStaff,
        isGstEnabled,
        login,
        logout,
        refreshUser,
        refreshCompany,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
