"use client";

import React from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { ShieldAlert } from "lucide-react";

// THE PLATFORM PERMISSION MIRROR.
//
// This mirrors the backend's rules so the console does not offer a button that
// is going to come back 403. It is NOT security: every one of these routes is
// gated on the server, and hiding a button has never stopped anybody who can
// open a network tab. If these two ever disagree, the server is right.

export const PERMISSION = {
  BUSINESS_CREATE: "BUSINESS_CREATE",
  BUSINESS_VIEW: "BUSINESS_VIEW",
  BUSINESS_EDIT: "BUSINESS_EDIT",
  SUBSCRIPTION_CREATE: "SUBSCRIPTION_CREATE",
  SUBSCRIPTION_VIEW: "SUBSCRIPTION_VIEW",
  SUBSCRIPTION_CANCEL: "SUBSCRIPTION_CANCEL",
  SUBSCRIPTION_GRANT: "SUBSCRIPTION_GRANT",
  PAYMENT_CREATE: "PAYMENT_CREATE",
  PAYMENT_VIEW: "PAYMENT_VIEW",
  PLAN_VIEW: "PLAN_VIEW",
} as const;

export type Permission = (typeof PERMISSION)[keyof typeof PERMISSION];

/** Human wording for each permission, for the sales-team form. */
export const PERMISSION_LABELS: Record<string, { label: string; description: string }> = {
  BUSINESS_CREATE: {
    label: "Register businesses",
    description: "Sign up a new shop and create its owner's login",
  },
  BUSINESS_VIEW: { label: "View businesses", description: "See the list of shops and their details" },
  BUSINESS_EDIT: { label: "Edit businesses", description: "Change a shop's details, and switch it on or off" },
  SUBSCRIPTION_CREATE: { label: "Sell subscriptions", description: "Sell a plan to a shop, or renew one" },
  SUBSCRIPTION_VIEW: { label: "View subscriptions", description: "See what each shop has bought" },
  SUBSCRIPTION_CANCEL: {
    label: "Cancel subscriptions",
    description: "End a shop's subscription. Kept separate from selling on purpose",
  },
  SUBSCRIPTION_GRANT: {
    label: "Recharge and grant subscriptions",
    description:
      "Give a shop a subscription by hand, including free access. The most powerful permission here - hand it out deliberately",
  },
  PAYMENT_CREATE: { label: "Collect payments", description: "Record money taken for a subscription" },
  PAYMENT_VIEW: { label: "View collections", description: "See the payments that have been collected" },
  PLAN_VIEW: { label: "View plans", description: "Read the price list. Editing it is admin-only" },
};

export function usePlatformUser() {
  const { user } = useAuth();

  const role = user?.role;
  const isPlatformAdmin = role === "PLATFORM_ADMIN";
  const isPlatformUser = isPlatformAdmin || role === "SALES_STAFF";
  const permissions: string[] = ((user as unknown as { permissions?: string[] })?.permissions) ?? [];

  /** A platform admin may do everything; anyone else needs it in their list. */
  const can = (permission: Permission) =>
    isPlatformAdmin || permissions.includes(permission);

  return { user, role, isPlatformAdmin, isPlatformUser, permissions, can };
}

/** Renders children only if the user holds the permission. */
export function Can({
  permission,
  children,
  fallback = null,
}: {
  permission: Permission;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { can } = usePlatformUser();
  return <>{can(permission) ? children : fallback}</>;
}

/** A whole page that only the operator's own people may open. */
export function PlatformGuard({
  children,
  adminOnly = false,
}: {
  children: React.ReactNode;
  adminOnly?: boolean;
}) {
  const { isPlatformUser, isPlatformAdmin } = usePlatformUser();

  const allowed = adminOnly ? isPlatformAdmin : isPlatformUser;

  if (!allowed) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
          <ShieldAlert className="w-6 h-6 text-muted-foreground" />
        </div>
        <h2 className="text-lg font-semibold">This area belongs to the platform team</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-md">
          {adminOnly
            ? "Only a platform administrator can open this page."
            : "Your account signs in to a business, not to the platform console."}
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
