"use client";

import * as React from "react";
import { useAuth } from "@/lib/auth/auth-context";

/**
 * Shows its children only when the company actually uses GST.
 *
 * GST is optional in this product and a local shop with no registration is a
 * first-class user. The answer comes from the backend (`gstProfile.gstEnabled`,
 * derived from whether a state code is configured) and is never hard-coded here.
 *
 * This hides UI. It does not make anything mandatory: a non-GST business simply
 * never sees a GSTIN, an HSN code, a tax rate or a place of supply.
 */
export function GstOnly({ children, fallback = null }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  const { isGstEnabled } = useAuth();
  return <>{isGstEnabled ? children : fallback}</>;
}
