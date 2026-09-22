"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { User, Company } from "@/types/api";
import { authApi, companyApi } from "@/lib/api";
import { APP_CONFIG } from "@/lib/constants";
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
      const token = localStorage.getItem(APP_CONFIG.tokenKey);
      if (!token) {
        setUser(null);
        setCompany(null);
        setIsLoading(false);
        return;
      }

      const currentUser = await authApi.getMe();
      setUser(currentUser);

      try {
        const currentCompany = await companyApi.getCurrentCompany();
        setCompany(currentCompany);
      } catch (compErr) {
        console.warn("Could not fetch active company:", compErr);
      }
    } catch (err) {
      console.warn("Session verification failed:", err);
      localStorage.removeItem(APP_CONFIG.tokenKey);
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
      localStorage.setItem(APP_CONFIG.tokenKey, result.token);
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
    localStorage.removeItem(APP_CONFIG.tokenKey);
    localStorage.removeItem(APP_CONFIG.companyKey);
    setUser(null);
    setCompany(null);
    router.push("/admin/login");
  };

  const refreshUser = async () => {
    if (!localStorage.getItem(APP_CONFIG.tokenKey)) return;
    const refreshed = await authApi.getMe();
    setUser(refreshed);
  };

  const refreshCompany = async () => {
    if (!localStorage.getItem(APP_CONFIG.tokenKey)) return;
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
