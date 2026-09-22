"use client";

import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import { Store } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ForbiddenState } from "@/components/shared/states";

/**
 * Route protection for everything behind a login.
 *
 * This is a convenience, not the security boundary. It exists so a signed-out
 * user lands on the login screen instead of watching a page fail to load, and so
 * the page they wanted is remembered. Every API call is refused by the Express
 * backend regardless of what this renders.
 */
export function AuthGuard({
  children,
  requireAdmin = false,
}: {
  children: React.ReactNode;
  requireAdmin?: boolean;
}) {
  const { isReady, isAuthenticated, isAdmin } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  React.useEffect(() => {
    if (isReady && !isAuthenticated) {
      router.replace("/login?redirect=" + encodeURIComponent(pathname ?? "/shop/dashboard"));
    }
  }, [isReady, isAuthenticated, router, pathname]);

  // Until the server has confirmed the token, showing either the app or the
  // login screen would be a guess. Wait.
  if (!isReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <span className="flex h-12 w-12 animate-pulse items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Store className="h-6 w-6" />
          </span>
          <p className="text-sm text-muted-foreground">Loading your business…</p>
        </div>
      </div>
    );
  }

  // The redirect above is already running; render nothing rather than flashing
  // the application to someone who is signed out.
  if (!isAuthenticated) return null;

  if (requireAdmin && !isAdmin) {
    return (
      <div className="p-4 sm:p-6">
        <ForbiddenState message="This section is for the business owner or an admin. Ask them to make the change for you." />
      </div>
    );
  }

  return <>{children}</>;
}
