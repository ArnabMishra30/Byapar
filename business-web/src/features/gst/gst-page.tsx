"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, ShieldCheck } from "lucide-react";
import { apiClient, gstApi } from "@/lib/api";
import { useAuth } from "@/lib/auth/auth-context";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, LoadingState, EmptyState } from "@/components/shared/states";
import { Money } from "@/components/shared/money";
import { DetailRow } from "@/components/shared/form-parts";
import { DateRangeFilter, type DateRangeValue } from "@/components/shared/date-range";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { startOfMonth } from "@/lib/utils";
import type { ApiSuccessResponse } from "@/types/api";

/**
 * GST.
 *
 * This screen only exists for a registered business - the navigation hides it
 * entirely otherwise, and if someone reaches the URL anyway it says plainly that
 * GST is not switched on rather than presenting empty tax figures.
 *
 * The return figures are PREPARED, not filed. The backend builds them from
 * posted documents and says so; nothing here submits anything to any portal.
 */

interface Gstr3b {
  period?: { fromDate: string; toDate: string };
  outwardSupplies?: Record<string, unknown>;
  inputTaxCredit?: {
    allOtherItc?: { totalTax: string; taxableAmount: string };
    netItcAvailable?: { totalTax: string };
  };
  netPosition?: Record<string, unknown>;
  notFiled?: string;
}

function TaxRow({ label, value }: { label: string; value?: string }) {
  return <DetailRow label={label}>{value ? <Money value={value} /> : "—"}</DetailRow>;
}

export function GstPage() {
  const { isGstEnabled } = useAuth();
  const [range, setRange] = React.useState<DateRangeValue>({
    fromDate: startOfMonth(),
    toDate: new Date().toISOString().slice(0, 10),
  });

  const profile = useQuery({
    queryKey: ["gst-profile"],
    queryFn: () => gstApi.getProfile(),
  });

  const summary = useQuery({
    queryKey: ["gst-summary", range.fromDate, range.toDate],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<{ summary: Record<string, unknown> }>>(
        "/tax/gst-summary",
        { params: range },
      );
      return res.data.data.summary;
    },
    enabled: isGstEnabled,
  });

  const gstr3b = useQuery({
    queryKey: ["gstr-3b", range.fromDate, range.toDate],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<{ gstr3b: Gstr3b }>>(
        "/tax/returns/gstr-3b",
        { params: range },
      );
      return res.data.data.gstr3b;
    },
    enabled: isGstEnabled && Boolean(range.fromDate && range.toDate),
  });

  // A non-GST shop should never end up here, but if it does, say why.
  if (!isGstEnabled) {
    return (
      <div className="space-y-6">
        <PageHeader title="GST" description="Tax settings and returns." />
        <EmptyState
          icon={ShieldCheck}
          title="GST is not switched on"
          description="Your business is not registered for GST, so there is nothing to show here. You do not need a GSTIN, HSN codes or tax rates to use Byapar — sales, purchases, stock, credit and expenses all work without them. If you register later, an admin can turn GST on in Business settings."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="GST"
        description="Your registration, and the figures for your returns."
        actions={<Badge variant="success">Registered</Badge>}
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">Your registration</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {profile.isLoading ? (
            <LoadingState rows={1} />
          ) : (
            <>
              <DetailRow label="GSTIN">{profile.data?.gstin ?? "—"}</DetailRow>
              <DetailRow label="State">
                {profile.data?.stateName ?? profile.data?.stateCode ?? "—"}
              </DetailRow>
              <DetailRow label="Registration type">
                {profile.data?.registrationType ?? "—"}
              </DetailRow>
            </>
          )}
        </CardContent>
      </Card>

      <DateRangeFilter value={range} onChange={setRange} />

      <Tabs defaultValue="summary">
        <TabsList>
          <TabsTrigger value="summary" className="gap-1.5">
            <ShieldCheck className="h-4 w-4" />
            Tax summary
          </TabsTrigger>
          <TabsTrigger value="gstr3b" className="gap-1.5">
            <FileText className="h-4 w-4" />
            GSTR-3B
          </TabsTrigger>
        </TabsList>

        <TabsContent value="summary">
          {summary.error ? (
            <ErrorState error={summary.error} onRetry={() => summary.refetch()} />
          ) : summary.isLoading ? (
            <LoadingState rows={2} />
          ) : (
            <Card>
              <CardContent className="p-5">
                <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
                  {Object.entries(summary.data ?? {})
                    .filter(([, value]) => typeof value === "string")
                    .slice(0, 12)
                    .map(([key, value]) => (
                      <TaxRow
                        key={key}
                        label={key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}
                        value={String(value)}
                      />
                    ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="gstr3b">
          {gstr3b.error ? (
            <ErrorState error={gstr3b.error} onRetry={() => gstr3b.refetch()} />
          ) : gstr3b.isLoading ? (
            <LoadingState rows={2} />
          ) : (
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">
                    Input tax credit (table 4)
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <TaxRow
                    label="All other ITC"
                    value={gstr3b.data?.inputTaxCredit?.allOtherItc?.totalTax}
                  />
                  <TaxRow
                    label="Net ITC available"
                    value={gstr3b.data?.inputTaxCredit?.netItcAvailable?.totalTax}
                  />
                </CardContent>
              </Card>

              {/* The backend states this on every return; it must not be lost in
                  the UI, because a prepared figure is not a filed one. */}
              <div className="rounded-lg border border-warning/25 bg-warning/5 p-3 text-sm text-muted-foreground">
                {gstr3b.data?.notFiled ??
                  "These figures are prepared from your posted bills. Nothing has been filed with the GST portal — use these numbers when you or your accountant file."}
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
