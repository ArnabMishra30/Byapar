"use client";

import { useQuery } from "@tanstack/react-query";
import { Gift } from "lucide-react";
import { offersApi } from "@/lib/api/offers";
import { ErrorState, LoadingState } from "@/components/shared/states";
import { Money } from "@/components/shared/money";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ReportShell, rangeParams, useReportRange } from "./report-shell";

/**
 * What went out free, and what it cost the shop: per offer, and items given
 * free by hand per person. Cost is what the goods left stock at.
 */
export function OffersReport() {
  const [range, setRange] = useReportRange();
  const report = useQuery({
    queryKey: ["reports", "offers", range.fromDate, range.toDate],
    queryFn: () => offersApi.report(rangeParams(range)),
  });

  return (
    <ReportShell
      title="Offers given"
      description="Free items that went out, and what they cost you."
      range={range}
      onRangeChange={setRange}
    >
      {report.isLoading ? (
        <LoadingState rows={3} />
      ) : report.error || !report.data ? (
        <ErrorState error={report.error} onRetry={() => report.refetch()} />
      ) : (
        <div className="space-y-4">
          <StatCard label="Cost of free items" value={<Money value={report.data.totalCost} />} icon={Gift} tone="dues" />
          {report.data.rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nothing given free in this period.</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {report.data.rows.map((row) => (
                <Card key={row.label}>
                  <CardContent className="space-y-2 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 font-semibold">{row.label}</p>
                      <Badge variant={row.kind === "OFFER" ? "default" : "warning"}>
                        {row.kind === "OFFER" ? "Offer" : "By hand"}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {row.timesGiven} bill{row.timesGiven === 1 ? "" : "s"} ·{" "}
                      {row.itemsGiven.map((i) => `${Number(i.quantity)} × ${i.name}`).join(", ")}
                    </p>
                    <p className="text-sm">
                      Cost to you: <Money value={row.cost} className="font-semibold" />
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </ReportShell>
  );
}
