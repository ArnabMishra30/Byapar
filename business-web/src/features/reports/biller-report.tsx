"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { HandCoins, Receipt, Users } from "lucide-react";
import { billerReportApi, METHOD_LABEL, type PersonDay } from "@/lib/api/staff";
import { PageHeader } from "@/components/shared/page-header";
import { PrintActions } from "@/components/shared/print-actions";
import { ErrorState, LoadingState } from "@/components/shared/states";
import { Money } from "@/components/shared/money";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toInputDate, formatDate } from "@/lib/utils";
import { ReportTabs } from "./report-shell";

/**
 * Who billed what on a day: each person's completed sales and the money they
 * took, split by cash / UPI / bank, so every counter's cash can be checked at
 * closing. Figures come straight from the server.
 */
export function BillerReport() {
  const [date, setDate] = React.useState(() => toInputDate());
  const report = useQuery({
    queryKey: ["reports", "billers", date],
    queryFn: () => billerReportApi.billers(date || undefined),
  });

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <PageHeader
          title="Billers' day"
          description="Each person's sales and the money they collected, for checking counters at closing."
          actions={<PrintActions title={`Billers' day ${date}`} />}
        />
        <ReportTabs />
      </div>

      <div className="flex items-end gap-3" data-print-hide>
        <div className="space-y-1.5">
          <Label htmlFor="biller-date">Day</Label>
          <Input id="biller-date" type="date" value={date} max={toInputDate()} onChange={(e) => setDate(e.target.value)} className="w-44" />
        </div>
      </div>

      {report.isLoading ? (
        <LoadingState rows={4} />
      ) : report.error || !report.data ? (
        <ErrorState error={report.error} onRetry={() => report.refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard label={`Sales on ${formatDate(report.data.date)}`} value={<Money value={report.data.totals.salesTotal} />} icon={Receipt} hint={`${report.data.totals.salesCount} bills`} />
            <StatCard label="Money collected" value={<Money value={report.data.totals.collected} />} icon={HandCoins} tone="cash" />
            <StatCard label="People" value={report.data.people.length} icon={Users} />
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {report.data.people.map((person) => (
              <PersonCard key={person.user.id} person={person} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function PersonCard({ person, title }: { person: PersonDay; title?: string }) {
  const methods = Object.entries(person.collectedByMethod);
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <p className="min-w-0 truncate font-semibold">{title ?? person.user.name}</p>
          <p className="shrink-0 text-xs text-muted-foreground">
            {person.salesCount} bill{person.salesCount === 1 ? "" : "s"}
            {person.cancelledCount > 0 ? ` · ${person.cancelledCount} cancelled` : ""}
            {person.priceChangedCount > 0 ? ` · ${person.priceChangedCount} price change${person.priceChangedCount === 1 ? "" : "s"}` : ""}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Sales</dt>
            <dd className="text-lg font-bold"><Money value={person.salesTotal} /></dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Money collected</dt>
            <dd className="text-lg font-bold text-success"><Money value={person.collected} /></dd>
          </div>
        </dl>
        {methods.length > 0 ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t pt-2 text-xs text-muted-foreground">
            {methods.map(([method, amount]) => (
              <span key={method}>
                {METHOD_LABEL[method] ?? method}: <Money value={amount} className="font-medium text-foreground" />
              </span>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
