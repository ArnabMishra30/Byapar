"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, Receipt, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { companyApi } from "@/lib/api";
import { useAuth } from "@/lib/auth/auth-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState } from "@/components/shared/states";
import { Can } from "@/components/shared/permission-gate";

/**
 * Business settings.
 *
 * READ-ONLY IN THIS PHASE, and it says so rather than showing a save button
 * that does nothing. The backend supports editing (PATCH /company-settings and
 * PATCH /tax/profile, both admin-only); the edit forms come with the settings
 * phase.
 *
 * The GST tab is present for every company, because it is where a shop that has
 * just registered goes to turn GST on. What it never does is REQUIRE a GSTIN:
 * a business with none sees "not registered" and carries on.
 */

function Field({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground sm:text-right">
        {value === undefined || value === null || value === "" ? (
          <span className="text-muted-foreground">Not set</span>
        ) : (
          value
        )}
      </span>
    </div>
  );
}

export default function SettingsPage() {
  const { company, gstProfile, isGstEnabled } = useAuth();

  const {
    data: settings,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["company-settings"],
    queryFn: () => companyApi.getSettings(),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Business settings"
        description="How your business is set up in Byapar."
      />

      <Can
        do="settings.manage"
        fallback={
          <div className="rounded-lg border border-warning/25 bg-warning/5 p-3 text-sm text-muted-foreground">
            You can see these settings but not change them. Ask an admin in your business to make
            changes.
          </div>
        }
      >
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-muted-foreground">
          Editing settings from this screen is coming in a later phase. Nothing here can be saved
          yet, so nothing is shown that pretends to.
        </div>
      </Can>

      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <Tabs defaultValue="business">
          <TabsList>
            <TabsTrigger value="business" className="gap-1.5">
              <Building2 className="h-4 w-4" />
              Business
            </TabsTrigger>
            <TabsTrigger value="general" className="gap-1.5">
              <SlidersHorizontal className="h-4 w-4" />
              General
            </TabsTrigger>
            <TabsTrigger value="gst" className="gap-1.5">
              <ShieldCheck className="h-4 w-4" />
              GST
            </TabsTrigger>
            <TabsTrigger value="accounting" className="gap-1.5">
              <Receipt className="h-4 w-4" />
              Accounting
            </TabsTrigger>
          </TabsList>

          <TabsContent value="business">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Business information</CardTitle>
                <CardDescription>Your shop as it appears on documents.</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <Field label="Business name" value={company?.name} />
                <Field label="Legal name" value={company?.legalName} />
                <Field label="Address" value={company?.registeredAddress} />
                <Field
                  label="Status"
                  value={
                    <Badge variant={company?.isActive === false ? "destructive" : "success"}>
                      {company?.isActive === false ? "Inactive" : "Active"}
                    </Badge>
                  }
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="general">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">General</CardTitle>
                <CardDescription>Currency, timezone and document numbering.</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                {isLoading ? (
                  <div className="space-y-3 py-2">
                    {[0, 1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-6 w-full" />
                    ))}
                  </div>
                ) : (
                  <>
                    <Field label="Currency" value={settings?.currency} />
                    <Field label="Timezone" value={settings?.timezone} />
                    <Field label="Date format" value={settings?.dateFormat} />
                    <Field label="Sales bill prefix" value={settings?.invoicePrefix} />
                    <Field label="Purchase bill prefix" value={settings?.purchasePrefix} />
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="gst">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">GST</CardTitle>
                <CardDescription>
                  {isGstEnabled
                    ? "Your GST registration details."
                    : "GST is optional. Your shop works fully without it."}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <Field
                  label="GST"
                  value={
                    <Badge variant={isGstEnabled ? "success" : "outline"}>
                      {isGstEnabled ? "Registered" : "Not registered"}
                    </Badge>
                  }
                />
                {isGstEnabled ? (
                  <>
                    <Field label="GSTIN" value={gstProfile?.gstin} />
                    <Field label="State" value={gstProfile?.stateName ?? gstProfile?.stateCode} />
                    <Field label="Registration type" value={gstProfile?.registrationType} />
                  </>
                ) : (
                  <p className="pt-3 text-sm text-muted-foreground">
                    You do not need a GSTIN, HSN codes or tax rates to use Byapar. Sales,
                    purchases, stock, credit and expenses all work without them. If you register
                    for GST later, an admin can turn it on here and tax features appear.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="accounting">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Accounting</CardTitle>
                <CardDescription>How your books are kept.</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                {isLoading ? (
                  <div className="space-y-3 py-2">
                    {[0, 1].map((i) => (
                      <Skeleton key={i} className="h-6 w-full" />
                    ))}
                  </div>
                ) : (
                  <>
                    <Field
                      label="Financial year starts"
                      value={
                        settings?.financialYearStartMonth
                          ? new Date(2000, settings.financialYearStartMonth - 1, 1).toLocaleString(
                              "en-IN",
                              { month: "long" },
                            )
                          : undefined
                      }
                    />
                    <Field
                      label="Every entry must be inside an open period"
                      value={
                        <Badge variant={settings?.requireOpenPeriod ? "warning" : "outline"}>
                          {settings?.requireOpenPeriod ? "Yes" : "No"}
                        </Badge>
                      }
                    />
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
