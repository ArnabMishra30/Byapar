"use client";

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { gstApi } from "@/lib/api";
import { useAuth } from "@/lib/auth/auth-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { GstBadge } from "@/components/shared/gst-badge";
import {
  ShieldCheck,
  Store,
  Sliders,
  FileCheck,
  Layers,
  ArrowRight,
  Info,
} from "lucide-react";
import Link from "next/link";

export default function GstPage() {
  const { company, isGstEnabled } = useAuth();

  const { data: profile, isLoading } = useQuery({
    queryKey: ["gst-profile"],
    queryFn: () => gstApi.getProfile(),
  });

  if (!isGstEnabled) {
    return (
      <div className="space-y-6 max-w-4xl">
        <div className="border-b pb-5">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
              <ShieldCheck className="w-7 h-7 text-primary" />
              <span>GST Compliance & Returns</span>
            </h1>
            <GstBadge isGstEnabled={false} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
            Indian Goods & Services Tax management and statutory reporting.
          </p>
        </div>

        <Card className="border-border/80 p-6 text-center space-y-4">
          <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center text-muted-foreground mx-auto">
            <Store className="w-7 h-7" />
          </div>
          <div className="space-y-1.5 max-w-md mx-auto">
            <h3 className="font-bold text-lg text-foreground">
              GST is Optional & Not Enabled for this Business
            </h3>
            <p className="text-xs text-muted-foreground">
              Your business is operating in simplified local shop mode. You can record sales, purchases, stock, and credit without any GSTIN or tax split requirements.
            </p>
          </div>

          <div className="pt-2">
            <Button asChild className="gap-2">
              <Link href="/admin/settings">
                <Sliders className="w-4 h-4" />
                <span>Configure GST in Settings</span>
              </Link>
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
              <ShieldCheck className="w-7 h-7 text-primary" />
              <span>GST Compliance</span>
            </h1>
            <GstBadge isGstEnabled={true} registrationType={company?.gstRegistrationType} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
            Tax classifications, frozen rate snapshots, and GSTR preparation summaries.
          </p>
        </div>

        <Button asChild variant="outline" size="sm" className="gap-2">
          <Link href="/admin/settings">
            <Sliders className="w-4 h-4" />
            <span>Tax Settings</span>
          </Link>
        </Button>
      </div>

      {/* Active Profile Info */}
      <Card className="border-sky-200 dark:border-sky-900 bg-sky-50/20 dark:bg-sky-950/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold text-sky-900 dark:text-sky-300">
            Registered GST Profile
          </CardTitle>
          <CardDescription className="text-xs">
            Tax jurisdiction and registration details
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <div>
            <span className="text-muted-foreground">GSTIN:</span>
            <p className="font-mono font-bold text-foreground mt-0.5">
              {company?.gstin || "—"}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">Home State Code:</span>
            <p className="font-semibold text-foreground mt-0.5">
              {company?.stateCode || "—"}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">Registration Type:</span>
            <p className="font-semibold text-foreground mt-0.5">
              {company?.gstRegistrationType || "REGULAR"}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Return Prep Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="border-border/80">
          <CardHeader>
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <FileCheck className="w-4 h-4 text-primary" />
              <span>GSTR-1 Outward Supplies</span>
            </CardTitle>
            <CardDescription className="text-xs">
              Outward supplies grouped by B2B (registered), B2C (unregistered), HSN summary, and rate table.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-2">
            <p>
              Credit notes and sales returns are automatically netted from HSN and rate summaries according to GST statutory rules.
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/80">
          <CardHeader>
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <Layers className="w-4 h-4 text-primary" />
              <span>GSTR-3B & Input Tax Credit (ITC)</span>
            </CardTitle>
            <CardDescription className="text-xs">
              Input tax summary derived from posted purchase bills and debit note reversals.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-2">
            <p>
              Reconciles 100% with the input tax GL accounts (Input CGST, Input SGST, Input IGST).
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
