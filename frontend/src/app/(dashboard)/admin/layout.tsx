"use client";

import React from "react";
import { AuthGuard } from "@/components/layout/auth-guard";

/**
 * Every /admin/* route is administrator-only.
 *
 * The sidebar already hides these links from STAFF, but hiding a link is not
 * access control: a staff member who types the URL, or follows a bookmark, was
 * still shown the page shell. The backend refuses the data with a 403 either
 * way, so nothing ever leaked - but the user saw an admin screen failing to
 * load rather than a clear answer about why they cannot be there.
 *
 * `AuthGuard` already had a `requiredRole` prop for exactly this and nothing was
 * using it. One layout covers every admin route, including any added later.
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AuthGuard requiredRole="ADMIN">{children}</AuthGuard>;
}
