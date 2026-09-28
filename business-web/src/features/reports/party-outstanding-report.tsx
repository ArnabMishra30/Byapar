"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AlarmClock, CalendarCheck, Users, Wallet } from "lucide-react";
import type { CreditPartyRow } from "@/lib/api";
import { DETAIL_ROUTES, ROUTES } from "@/lib/constants";
import { formatDate, toInputDate } from "@/lib/utils";
import { DataTable, type Column } from "@/components/shared/data-table";
import { StatCard } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ReportNote, ReportSection, ReportShell, StatGrid, ToggleChip } from "./report-shell";
import { reportCalls } from "./api";

type Kind = "customer" | "supplier";

const COPY: Record<
  Kind,
  {
    title: string;
    description: string;
    total: string;
    party: string;
    parties: string;
    empty: string;
    emptyOverdue: string;
    payLabel: string;
  }
> = {
  customer: {
    title: "Customer report",
    description: "Who owes you money, how much, and for how long.",
    total: "Customers owe you",
    party: "Customer",
    parties: "customers",
    empty: "No customer owes you anything",
    emptyOverdue: "No customer is overdue",
    payLabel: "Receive",
  },
  supplier: {
    title: "Supplier report",
    description: "Which suppliers you owe, how much, and for how long.",
    total: "You owe suppliers",
    party: "Supplier",
    parties: "suppliers",
    empty: "You owe no supplier anything",
    emptyOverdue: "Nothing owed to suppliers is overdue",
    payLabel: "Pay",
  },
};

/**
 * Customer and supplier reports: the credit book as a report, as of a date.
 *
 * Every figure - outstanding, overdue, age - is the backend's, measured against
 * the date chosen here. Nothing is totalled on this side.
 */
export function PartyOutstandingReport({ kind }: { kind: Kind }) {
  const router = useRouter();
  const copy = COPY[kind];
  const [asOfDate, setAsOfDate] = React.useState(() => toInputDate());
  const [overdueOnly, setOverdueOnly] = React.useState(false);

  const report = useQuery({
    queryKey: ["report", `${kind}-outstanding`, asOfDate, overdueOnly],
    queryFn: () =>
      kind === "customer"
        ? reportCalls.customerOutstanding({ asOfDate: asOfDate || undefined, overdueOnly })
        : reportCalls.supplierOutstanding({ asOfDate: asOfDate || undefined, overdueOnly }),
  });

  const summary = report.data?.summary;
  const rows = kind === "customer" ? report.data?.customers : report.data?.suppliers;

  const detail = (row: CreditPartyRow) =>
    kind === "customer" ? DETAIL_ROUTES.customer(row.partyId) : DETAIL_ROUTES.supplier(row.partyId);
  const payHref = (row: CreditPartyRow) =>
    kind === "customer"
      ? `${ROUTES.moneyReceived}?customerId=${row.partyId}`
      : `${ROUTES.moneyPaid}?supplierId=${row.partyId}`;

  const columns: Column<CreditPartyRow>[] = [
    {
      header: copy.party,
      cell: (row) => (
        <span className="block">
          <span className="block font-medium">{row.name}</span>
          {row.phone ? <span className="block text-xs text-muted-foreground">{row.phone}</span> : null}
        </span>
      ),
    },
    { header: "Pending", numeric: true, cell: (row) => <Money value={row.outstanding} className="font-semibold" /> },
    {
      header: "Overdue",
      numeric: true,
      cell: (row) =>
        row.isOverdue ? <Money value={row.overdue} className="text-destructive" /> : <span className="text-muted-foreground">—</span>,
    },
    {
      header: "Oldest bill",
      hideOnMobile: true,
      cell: (row) =>
        row.oldestDocumentDate ? (
          <span className="block">
            <span className="block">{formatDate(row.oldestDocumentDate)}</span>
            {row.ageInDays != null ? (
              <span className="block text-xs text-muted-foreground">{row.ageInDays} days</span>
            ) : null}
          </span>
        ) : (
          "—"
        ),
    },
    {
      header: "Last payment",
      hideOnMobile: true,
      cell: (row) =>
        row.lastPayment ? (
          <span className="block">
            <Money value={row.lastPayment.amount} />
            <span className="block text-xs text-muted-foreground">{formatDate(row.lastPayment.date)}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">None</span>
        ),
    },
    {
      header: "Action",
      cell: (row) => (
        <Button asChild variant="outline" size="sm" onClick={(e) => e.stopPropagation()}>
          <Link href={payHref(row)}>{copy.payLabel}</Link>
        </Button>
      ),
    },
  ];

  return (
    <ReportShell
      title={copy.title}
      description={copy.description}
      filters={
        <>
          <label className="flex h-10 w-full items-center gap-2 rounded-lg border border-input bg-background px-3 sm:w-auto">
            <span className="shrink-0 text-xs font-medium text-muted-foreground">As of</span>
            <Input
              type="date"
              aria-label="As of date"
              className="h-auto min-w-0 flex-1 border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
              value={asOfDate}
              max={toInputDate()}
              onChange={(e) => setAsOfDate(e.target.value)}
            />
          </label>
          <ToggleChip pressed={overdueOnly} onPressedChange={setOverdueOnly}>
            <AlarmClock className="h-4 w-4" aria-hidden />
            Overdue only
          </ToggleChip>
        </>
      }
    >
      <StatGrid>
        <StatCard
          label={copy.total}
          icon={Wallet}
          tone={kind === "customer" ? "credit" : "dues"}
          isLoading={report.isLoading}
          value={<Money value={summary?.total} />}
          hint={report.data ? `As of ${formatDate(report.data.asOf)}` : undefined}
        />
        <StatCard
          label="Overdue"
          icon={AlarmClock}
          tone="dues"
          isLoading={report.isLoading}
          value={<Money value={summary?.overdue} />}
          hint={summary ? `${summary.overduePartyCount} ${copy.parties}` : undefined}
        />
        <StatCard
          label="Not yet due"
          icon={CalendarCheck}
          isLoading={report.isLoading}
          value={<Money value={summary?.notYetDue} />}
        />
        <StatCard
          label={kind === "customer" ? "Customers with dues" : "Suppliers you owe"}
          icon={Users}
          isLoading={report.isLoading}
          value={summary?.partyCount ?? "—"}
        />
      </StatGrid>

      <ReportSection title={kind === "customer" ? "Who owes you" : "Who you owe"} contentClassName="px-3 sm:px-6">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.partyId}
          isLoading={report.isLoading}
          error={report.error}
          onRetry={() => report.refetch()}
          onRowClick={(row) => router.push(detail(row))}
          mobileCard={(row) => (
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{row.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.oldestDocumentDate
                      ? `Oldest bill ${formatDate(row.oldestDocumentDate)}`
                      : "No dated bill"}
                  </p>
                </div>
                <Money value={row.outstanding} className="shrink-0 font-semibold" />
              </div>
              <div className="flex items-center justify-between gap-2">
                {row.isOverdue ? (
                  <Badge variant="destructive">
                    Overdue&nbsp;<Money value={row.overdue} />
                  </Badge>
                ) : (
                  <Badge variant="outline">Not overdue</Badge>
                )}
                <Button asChild variant="outline" size="sm" onClick={(e) => e.stopPropagation()}>
                  <Link href={payHref(row)}>{copy.payLabel}</Link>
                </Button>
              </div>
            </div>
          )}
          emptyTitle={overdueOnly ? copy.emptyOverdue : copy.empty}
          emptyDescription={
            overdueOnly ? "Turn off “Overdue only” to see everything pending." : "Credit bills that are not fully paid appear here."
          }
        />
        <div className="mt-3">
          <ReportNote>{report.data?.note}</ReportNote>
        </div>
      </ReportSection>
    </ReportShell>
  );
}

export function CustomerReport() {
  return <PartyOutstandingReport kind="customer" />;
}

export function SupplierReport() {
  return <PartyOutstandingReport kind="supplier" />;
}
