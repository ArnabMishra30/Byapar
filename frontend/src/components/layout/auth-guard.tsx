"use client";

import { roleLabel } from "@/lib/auth/roles";

import React, { useEffect } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { useRouter, usePathname } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AuthGuardProps {
  children: React.ReactNode;
  requiredRole?: "ADMIN" | "STAFF";
}

export function AuthGuard({ children, requiredRole }: AuthGuardProps) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push(`/admin/login?redirect=${encodeURIComponent(pathname)}`);
    }
  }, [isLoading, isAuthenticated, router, pathname]);

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center p-6 bg-background">
        <div className="flex flex-col items-center space-y-4 max-w-sm w-full">
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary animate-pulse">
            <span className="font-bold text-xl">B</span>
          </div>
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-3 w-32" />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  if (requiredRole && user?.role !== requiredRole && user?.role !== "ADMIN") {
    return (
      <div className="flex h-[70vh] flex-col items-center justify-center text-center p-6">
        <div className="w-12 h-12 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mb-4">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-bold text-foreground">Access Restricted</h2>
        <p className="text-sm text-muted-foreground max-w-md mt-1 mb-6">
          This area is restricted to administrators. Your account has the{" "}
          <strong className="text-foreground">{roleLabel(user?.role)}</strong> role.
        </p>
        <Button onClick={() => router.push("/dashboard")}>
          Return to Dashboard
        </Button>
      </div>
    );
  }

  return <>{children}</>;
}
