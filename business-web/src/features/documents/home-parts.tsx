"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, FilePen } from "lucide-react";
import { DataTable, type Column } from "@/components/shared/data-table";
import { DateRangeFilter, type DateRangeValue } from "@/components/shared/date-range";
import { Money } from "@/components/shared/money";
import { PaidDue } from "@/components/shared/paid-due";
import { StatusBadge } from "@/components/shared/status-badge";
import { ErrorState, LoadingState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, startOfMonth } from "@/lib/utils";
import { DOC_CONFIG, type DocKind } from "./config";
import { fromDocument, type DocRow } from "./doc-helpers";
import { DocRowActions } from "./doc-row-actions";
import { PartyFilter, type PartyValue } from "./party-filter";

/**
 * The pieces the Sales and Purchase landing pages share.
 *
 * Both answer the same two questions - "how much in this period, and who still
 * owes / is owed" and "what is saved but not finished" - from the same backend
 * calls, so they are written once.
 */

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Total for a chosen period, plus the most recent completed documents in it.
 * The total is the register's own period total, not a sum of the rows shown.
 */
export function PeriodRegisterCard({ kind }: { kind: DocKind }) {
  const config = DOC_CONFIG[kind];
  const router = useRouter();
  const [range, setRange] = React.useState<DateRangeValue>({ fromDate: startOfMonth(), toDate: today() });
  const [party, setParty] = React.useState<PartyValue | null>(null);

  const params = {
    page: 1,
    limit: 8,
    fromDate: range.fromDate,
    toDate: range.toDate,
    [config.partyField]: party?.id,
  };

  const register = useQuery({
    queryKey: [kind, "register", params],
    queryFn: () => config.register(params),
  });

  const totals = register.data?.totals;
  const noun = kind === "sale" ? "sales" : "purchases";

  const columns: Column<DocRow>[] = [
    {
      header: kind === "sale" ? "Invoice no." : "Bill no.",
      cell: (row) => (
        <Link
          href={config.detailHref(row.id)}
          className="font-medium hover:text-primary"
          onClick={(e) => e.stopPropagation()}
        >
          {row.number}
        </Link>
      ),
    },
    { header: "Date", cell: (row) => <span className="whitespace-nowrap">{formatDate(row.date)}</span> },
    {
      header: config.partyLabel,
      cell: (row) => <span className="block max-w-[12rem] truncate">{row.partyName}</span>,
    },
    { header: "Amount", numeric: true, cell: (row) => <Money value={row.total} /> },
    {
      header: "Paid",
      numeric: true,
      hideOnMobile: true,
      cell: (row) => (row.paid != null ? <Money value={row.paid} className="text-success" /> : "—"),
    },
    { header: "Due", numeric: true, cell: (row) => (row.due != null ? <Money value={row.due} /> : "—") },
    { header: "Status", cell: (row) => <StatusBadge status={row.paymentStatus ?? undefined} /> },
    { header: "Actions", className: "w-12", cell: (row) => <DocRowActions kind={kind} row={row} /> },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {kind === "sale" ? "Sales in a period" : "Purchases in a period"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 lg:grid-cols-2">
          <DateRangeFilter value={range} onChange={setRange} />
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{config.partyLabel}</p>
            <PartyFilter kind={config.partyKind} value={party} onChange={setParty} />
          </div>
        </div>

        {/* The period total, straight from the register's totals block. */}
        <div className="grid gap-3 sm:grid-cols-3">
          <Figure
            label={`Total ${noun}`}
            isLoading={register.isLoading}
            value={totals ? <Money value={totals.total} /> : "—"}
            hint={totals ? `${totals.count} ${kind === "sale" ? "invoices" : "bills"}` : undefined}
          />
          {totals?.returns != null ? (
            <Figure
              label="Returns"
              isLoading={register.isLoading}
              value={<Money value={totals.returns} />}
              hint={totals.returnCount != null ? `${totals.returnCount} returns` : undefined}
            />
          ) : null}
          {totals?.net != null ? (
            <Figure
              label={kind === "sale" ? "Net sales" : "Net purchases"}
              isLoading={register.isLoading}
              value={<Money value={totals.net} />}
              hint="After returns"
            />
          ) : null}
        </div>

        <DataTable
          columns={columns}
          rows={register.data?.rows}
          rowKey={(row) => row.id}
          isLoading={register.isLoading}
          error={register.error}
          onRetry={() => register.refetch()}
          onRowClick={(row) => router.push(config.detailHref(row.id))}
          mobileCard={(row) => (
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold">{row.partyName}</p>
                  <StatusBadge status={row.paymentStatus ?? undefined} />
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {row.number} · {formatDate(row.date)}
                </p>
                <PaidDue paid={row.paid} due={row.due} />
              </div>
              <DocRowActions kind={kind} row={row} />
            </div>
          )}
          emptyTitle={`No completed ${noun} in this period`}
          emptyDescription="Try a wider date range."
        />

        <Button asChild variant="outline" className="w-full gap-1.5 sm:w-auto">
          <Link href={config.listHref}>
            See all {kind === "sale" ? "invoices" : "purchase bills"}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function Figure({
  label,
  value,
  hint,
  isLoading,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  isLoading?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-lg border bg-muted/20 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      {isLoading ? (
        <Skeleton className="mt-1 h-6 w-24" />
      ) : (
        <p className="truncate text-lg font-bold tabular-nums">{value}</p>
      )}
      {hint && !isLoading ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Saved but not completed: the "finish these" list. */
export function DraftsCard({ kind }: { kind: DocKind }) {
  const config = DOC_CONFIG[kind];
  const drafts = useQuery({
    queryKey: [kind, "list", "DRAFT", "home"],
    queryFn: () => config.api.list({ status: "DRAFT", limit: 5 }),
  });

  const rows = drafts.data?.items.map((doc) => fromDocument(kind, doc)) ?? [];
  const total = drafts.data?.pagination?.total ?? 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <FilePen className="h-4 w-4 text-muted-foreground" aria-hidden />
          Drafts waiting to be completed
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {drafts.error ? (
          <ErrorState error={drafts.error} onRetry={() => drafts.refetch()} />
        ) : drafts.isLoading ? (
          <LoadingState rows={2} />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No drafts. Everything saved has been completed or cancelled.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {rows.map((row) => (
              <li key={row.id} className="flex items-center gap-2 p-2 pl-3">
                <Link href={config.detailHref(row.id)} className="min-w-0 flex-1 py-1">
                  <p className="truncate text-sm font-medium">{row.partyName || "—"}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.number || "Draft"} · {formatDate(row.date)} · <Money value={row.total} />
                  </p>
                </Link>
                <DocRowActions kind={kind} row={row} />
              </li>
            ))}
          </ul>
        )}
        {total > rows.length ? (
          <Button asChild variant="link" className="h-auto px-0">
            <Link href={`${config.listHref}?tab=drafts`}>See all {total} drafts</Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
