"use client";

import * as React from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { whyNot, type Capability } from "@/lib/permissions";

/**
 * Hides or explains an action the current role cannot perform.
 *
 * FOR USER EXPERIENCE ONLY. The Express backend refuses the request regardless,
 * and that is the boundary that matters. This exists so a staff member is told
 * why a button is missing instead of walking into a 403.
 */
export function Can({
  do: capability,
  children,
  fallback,
  explain = false,
}: {
  do: Capability;
  children: React.ReactNode;
  fallback?: React.ReactNode;
  /** Show a short line saying who can do this, instead of hiding silently. */
  explain?: boolean;
}) {
  const { can } = useAuth();

  if (can(capability)) return <>{children}</>;
  if (fallback !== undefined) return <>{fallback}</>;
  if (explain) return <p className="text-xs text-muted-foreground">{whyNot(capability)}</p>;
  return null;
}
