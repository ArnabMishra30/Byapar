"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Boxes,
  Landmark,
  Receipt,
  ShoppingCart,
  TrendingUp,
  UserCheck,
  Truck,
  Wallet,
} from "lucide-react";
import { reportsApi } from "@/lib/api";
import { useAuth } from "@/lib/auth/auth-context";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, LoadingState, EmptyState } from "@/components/shared/states";
import { Money } from "@/components/shared/money";
import { DateRangeFilter, type DateRangeValue } from "@/components/shared/date-range";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, startOfMonth, cn } from "@/lib/utils";

/**
 * Reports.
 *
 * ONLY the reports the backend actually publishes. Nothing here is assembled in
 * the browser from raw transactions - each tab calls the report endpoint that
 * owns that question, and shows what it returns.
 *
 * The GST tab appears only for a registered business.
 */

type ReportKey =
  | "profit"
  | "sales"
  | "purchases"
  | "expenses"
  | "cash"
  | "stock"
  | "receivables"
  | "payables";

interface ReportDef {
  key: ReportKey;
  label: string;
  description: string;
  icon: React.ElementType;
  needsRange: boolean;
  load: (range: DateRangeValue) => Promise<unknown>;
}

const REPORTS: ReportDef[] = [
  {
    key: "profit",
    label: "Profit",
    description: "What you earned, what it cost, and what is left.",
    icon: TrendingUp,
    needsRange: true,
    load: (r) => reportsApi.profitLoss(r),
  },
  {
    key: "sales",
    label: "Sales",
    description: "Everything you sold in the period.",
    icon: Receipt,
    needsRange: true,
    load: (r) => reportsApi.sales({ ...r, limit: 100 }),
  },
  {
    key: "purchases",
    label: "Purchases",
    description: "Everything you bought in the period.",
    icon: ShoppingCart,
    needsRange: true,
    load: (r) => reportsApi.purchases({ ...r, limit: 100 }),
  },
  {
    key: "expenses",
    label: "Expenses",
    description: "What running the shop cost.",
    icon: Wallet,
    needsRange: true,
    load: (r) => reportsApi.expenses(r),
  },
  {
    key: "cash",
    label: "Cash & bank",
    description: "Money in and out, and the balances.",
    icon: Landmark,
    needsRange: true,
    load: (r) => reportsApi.cashBank({ ...r, limit: 100 }),
  },
  {
    key: "stock",
    label: "Stock value",
    description: "What your stock is worth right now.",
    icon: Boxes,
    needsRange: false,
    load: () => reportsApi.inventoryValuation(),
  },
  {
    key: "receivables",
    label: "Customers owe",
    description: "Outstanding by customer.",
    icon: UserCheck,
    needsRange: false,
    load: () => reportsApi.customerOutstanding(),
  },
  {
    key: "payables",
    label: "You owe",
    description: "Outstanding by supplier.",
    icon: Truck,
    needsRange: false,
    load: () => reportsApi.supplierOutstanding(),
  },
];

/** Renders whatever a report returns, without pretending to understand it. */
function ReportBody({ data }: { data: unknown }) {
  if (!data || typeof data !== "object") {
    return <EmptyState title="Nothing to show" description="This report returned no data." />;
  }

  const record = data as Record<string, unknown>;

  // Any object of 2dp money strings at the top level is a totals block.
  const totals = Object.entries(record).filter(
    ([, value]) => typeof value === "string" && /^-?\d+\.\d{2}$/.test(value),
  );

  // The first array of objects is the detail table.
  const rowsEntry = Object.entries(record).find(
    ([, value]) => Array.isArray(value) && value.length > 0 && typeof value[0] === "object",
  );
  const rows = (rowsEntry?.[1] as Record<string, unknown>[] | undefined) ?? [];

  // Nested totals objects, e.g. { totals: { totalSales: "..." } }.
  const nestedTotals = Object.entries(record).flatMap(([key, value]) => {
    if (key === "period" || !value || typeof value !== "object" || Array.isArray(value)) return [];
    return Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => typeof v === "string" && /^-?\d+\.\d{2}$/.test(v))
      .map(([k, v]) => [k, v] as [string, unknown]);
  });

  const allTotals = [...totals, ...nestedTotals].slice(0, 8);

  const humanise = (key: string) =>
    key
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (c) => c.toUpperCase())
      .trim();

  const columns = rows.length > 0 ? Object.keys(rows[0]).filter((k) => k !== "rawAmount").slice(0, 6) : [];

  return (
    <div className="space-y-4">
      {allTotals.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {allTotals.map(([key, value]) => (
            <Card key={key}>
              <CardContent className="p-4">
                <p className="truncate text-xs text-muted-foreground">{humanise(key)}</p>
                <p className="mt-0.5 text-lg font-bold">
                  <Money value={String(value)} tone="auto" />
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div className="rounded-xl border bg-card">
          <div className="w-full overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((column) => (
                    <TableHead key={column}>{humanise(column)}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.slice(0, 100).map((row, index) => (
                  <TableRow key={index}>
                    {columns.map((column) => {
                      const value = row[column];
                      const isMoney = typeof value === "string" && /^-?\d+\.\d{2}$/.test(value);
                      const isDate = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

                      return (
                        <TableCell key={column} className={cn(isMoney && "text-right tabular")}>
                          {value === null || value === undefined ? (
                            "—"
                          ) : isMoney ? (
                            <Money value={value} />
                          ) : isDate ? (
                            formatDate(value)
                          ) : typeof value === "object" ? (
                            String((value as Record<string, unknown>).name ?? "—")
                          ) : (
                            String(value)
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : allTotals.length === 0 ? (
        <EmptyState
          title="Nothing in this period"
          description="Try a wider date range."
        />
      ) : null}

      {typeof record.note === "string" ? (
        <p className="text-xs text-muted-foreground">{record.note}</p>
      ) : null}
    </div>
  );
}

export function ReportsPage() {
  const { isGstEnabled } = useAuth();
  const [active, setActive] = React.useState<ReportKey>("profit");
  const [range, setRange] = React.useState<DateRangeValue>({
    fromDate: startOfMonth(),
    toDate: new Date().toISOString().slice(0, 10),
  });

  const definition = REPORTS.find((r) => r.key === active)!;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["report", active, range.fromDate, range.toDate],
    queryFn: () => definition.load(range),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="How the business is doing, straight from your books."
      />

      {/* Scrollable chips rather than a dropdown: a shop switches between two or
          three reports constantly, and a chip is one tap. */}
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex gap-2 pb-1">
          {REPORTS.map((report) => (
            <Button
              key={report.key}
              variant={active === report.key ? "default" : "outline"}
              size="sm"
              className="shrink-0 gap-1.5"
              onClick={() => setActive(report.key)}
            >
              <report.icon className="h-3.5 w-3.5" />
              {report.label}
            </Button>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-foreground">{definition.label}</h2>
        <p className="text-xs text-muted-foreground">{definition.description}</p>
      </div>

      {definition.needsRange ? <DateRangeFilter value={range} onChange={setRange} /> : null}

      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <LoadingState rows={4} />
      ) : (
        <ReportBody data={data} />
      )}

      {isGstEnabled ? (
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <BarChart3 className="h-5 w-5 shrink-0 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              GST returns and tax summaries are on the{" "}
              <a href="/shop/gst" className="font-medium text-primary hover:underline">
                GST screen
              </a>
              .
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
