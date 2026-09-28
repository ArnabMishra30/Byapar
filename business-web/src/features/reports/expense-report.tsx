"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Crown, Receipt, Wallet } from "lucide-react";
import { ROUTES } from "@/lib/constants";
import { formatDate } from "@/lib/utils";
import { DataTable, type Column } from "@/components/shared/data-table";
import { StatCard } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { Button } from "@/components/ui/button";
import { ReportNote, ReportSection, ReportShell, StatGrid, rangeParams, useReportRange } from "./report-shell";
import { humanise } from "./report-parts";
import { reportCalls, type ExpenseReport as ExpenseReportData } from "./api";

type CategoryRow = ExpenseReportData["byCategory"][number];
type DateRow = ExpenseReportData["byDate"][number];

/**
 * Expense report: where the shop's money went, by category, by how it was paid
 * and by day. POSTED expenses only; the backend lists drafts, cancelled and
 * reversed ones separately and never counts them in a total.
 */
export function ExpenseReport() {
  const [range, setRange] = useReportRange();
  const params = rangeParams(range);

  const report = useQuery({
    queryKey: ["report", "expenses", params],
    queryFn: () => reportCalls.expenses(params),
  });

  const data = report.data;

  const categoryColumns: Column<CategoryRow>[] = [
    { header: "Category", cell: (row) => <span className="font-medium">{row.category}</span> },
    { header: "Entries", numeric: true, cell: (row) => row.expenseCount },
    { header: "Amount", numeric: true, cell: (row) => <Money value={row.amount} className="font-semibold" /> },
  ];

  const dateColumns: Column<DateRow>[] = [
    { header: "Date", cell: (row) => formatDate(row.date) },
    { header: "Entries", numeric: true, cell: (row) => row.expenseCount },
    { header: "Amount", numeric: true, cell: (row) => <Money value={row.amount} /> },
  ];

  return (
    <ReportShell
      title="Expense report"
      description="Where your money went: rent, salary, electricity and more."
      range={range}
      onRangeChange={setRange}
    >
      <StatGrid>
        <StatCard
          label="Total expenses"
          icon={Wallet}
          tone="dues"
          isLoading={report.isLoading}
          value={<Money value={data?.totals.totalExpenses} />}
          hint={data ? `${data.totals.expenseCount} ${data.totals.expenseCount === 1 ? "entry" : "entries"}` : undefined}
        />
        <StatCard
          label="Biggest category"
          icon={Crown}
          isLoading={report.isLoading}
          value={data?.totals.largestCategory?.category ?? "—"}
          hint={data?.totals.largestCategory ? <Money value={data.totals.largestCategory.amount} /> : undefined}
        />
        <StatCard
          label="Categories used"
          icon={Receipt}
          isLoading={report.isLoading}
          value={data?.byCategory.length ?? "—"}
        />
      </StatGrid>

      <ReportSection title="By category" contentClassName="px-3 sm:px-6">
        <DataTable
          columns={categoryColumns}
          rows={data?.byCategory}
          rowKey={(row) => row.accountId}
          isLoading={report.isLoading}
          error={report.error}
          onRetry={() => report.refetch()}
          mobileCard={(row) => (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{row.category}</p>
                <p className="text-xs text-muted-foreground">
                  {row.expenseCount} {row.expenseCount === 1 ? "entry" : "entries"}
                </p>
              </div>
              <Money value={row.amount} className="shrink-0 font-semibold" />
            </div>
          )}
          emptyTitle="No expenses in this period"
          emptyDescription="Posted expenses appear here. Try a wider date range, or add an expense."
          emptyAction={
            <Button asChild>
              <Link href={`${ROUTES.expenses}?new=1`}>Add expense</Link>
            </Button>
          }
        />
      </ReportSection>

      {data && data.byCategory.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <ReportSection title="How it was paid">
            <ul className="divide-y">
              {data.byPaymentAccount.map((row) => (
                <li key={row.accountId} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium">{row.account}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {row.expenseCount} {row.expenseCount === 1 ? "entry" : "entries"}
                    </span>
                  </span>
                  <Money value={row.amount} className="font-semibold" />
                </li>
              ))}
              {data.byPaymentAccount.length === 0
                ? data.byPaymentMode.map((row) => (
                    <li key={row.paymentMode} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <span className="font-medium">{humanise(row.paymentMode)}</span>
                      <Money value={row.amount} className="font-semibold" />
                    </li>
                  ))
                : null}
            </ul>
          </ReportSection>

          <ReportSection title="Not counted in the total" description="Kept for your records; they never moved money.">
            <ul className="divide-y">
              {data.otherStatuses.map((row) => (
                <li key={row.status} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="block font-medium">
                      {humanise(row.status)} ({row.count})
                    </span>
                    <span className="block text-xs text-muted-foreground">{row.reason}</span>
                  </span>
                  <Money value={row.amount} className="shrink-0 text-muted-foreground" />
                </li>
              ))}
            </ul>
          </ReportSection>
        </div>
      ) : null}

      {data && data.byDate.length > 0 ? (
        <ReportSection title="Day by day" contentClassName="px-3 sm:px-6">
          <DataTable
            columns={dateColumns}
            rows={data.byDate}
            rowKey={(row) => row.date}
            mobileCard={(row) => (
              <div className="flex items-center justify-between gap-3 text-sm">
                <span>{formatDate(row.date)}</span>
                <Money value={row.amount} className="font-semibold" />
              </div>
            )}
          />
        </ReportSection>
      ) : null}

      <ReportNote>{data?.note}</ReportNote>
    </ReportShell>
  );
}
