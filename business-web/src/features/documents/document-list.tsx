"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, useListState, type Column } from "@/components/shared/data-table";
import { DateRangeFilter, type DateRangeValue } from "@/components/shared/date-range";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import { Can } from "@/components/shared/permission-gate";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { DOC_CONFIG, type DocKind } from "./config";

/** The list of sales or purchases, with the filters a shop actually uses. */
export function DocumentList({ kind }: { kind: DocKind }) {
  const config = DOC_CONFIG[kind];
  const list = useListState({ limit: 20 });
  const [range, setRange] = React.useState<DateRangeValue>({});
  const [status, setStatus] = React.useState("");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [kind, "list", list.page, range.fromDate, range.toDate, status],
    queryFn: () =>
      config.api.list({
        page: list.page,
        limit: list.limit,
        fromDate: range.fromDate,
        toDate: range.toDate,
        status: status || undefined,
      }),
  });

  const columns: Column<Record<string, unknown>>[] = [
    {
      header: "Number",
      cell: (row) => (
        <Link
          href={config.detailHref(String(row.id))}
          className="font-medium text-foreground hover:text-primary"
        >
          {config.numberOf(row)}
        </Link>
      ),
    },
    {
      header: "Date",
      cell: (row) => (
        <span className="whitespace-nowrap">{formatDate(String(row[config.dateField] ?? ""))}</span>
      ),
    },
    {
      header: config.partyLabel,
      cell: (row) => {
        const party = row[config.partyKind] as { name?: string } | undefined;
        return <span className="block max-w-[12rem] truncate">{party?.name ?? "—"}</span>;
      },
    },
    {
      header: "Due",
      hideOnMobile: true,
      cell: (row) => (row.dueDate ? formatDate(String(row.dueDate)) : "—"),
    },
    {
      header: "Amount",
      numeric: true,
      cell: (row) => <Money value={String(row.grandTotal ?? "0")} />,
    },
    {
      header: "Status",
      cell: (row) => <StatusBadge status={String(row.status ?? "")} />,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={config.listTitle}
        description={config.listDescription}
        actions={
          <Can do={config.draftCapability}>
            <Button asChild className="gap-1.5">
              <Link href={config.newHref}>
                <Plus className="h-4 w-4" />
                {config.newTitle}
              </Link>
            </Button>
          </Can>
        }
      />

      <DataTable
        columns={columns}
        rows={data?.items}
        rowKey={(row) => String(row.id)}
        isLoading={isLoading}
        error={error}
        onRetry={() => refetch()}
        mobileCard={(row) => (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              {/* The SAME accessors the columns use, so the card cannot drift
                  from the table it replaces. */}
              <p className="truncate text-sm font-medium">
                {(row[config.partyKind] as { name?: string } | undefined)?.name ?? "—"}
              </p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {formatDate(String(row[config.dateField] ?? ""))} · {config.numberOf(row)}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <Money value={String(row.grandTotal ?? "0")} className="text-sm font-semibold" />
              <StatusBadge status={String(row.status ?? "")} />
            </div>
          </div>
        )}
        filters={
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <DateRangeFilter
              value={range}
              onChange={(next) => {
                setRange(next);
                list.setPage(1);
              }}
            />
            <div className="grid gap-1">
              <label htmlFor="doc-status" className="text-[11px] text-muted-foreground">
                Status
              </label>
              <select
                id="doc-status"
                className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  list.setPage(1);
                }}
              >
                <option value="">All</option>
                <option value="DRAFT">Draft</option>
                <option value="POSTED">Posted</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </div>
          </div>
        }
        pagination={
          data?.pagination
            ? {
                page: data.pagination.page,
                totalPages: data.pagination.totalPages,
                total: data.pagination.total,
                onPageChange: list.setPage,
              }
            : undefined
        }
        emptyTitle={config.emptyTitle}
        emptyDescription={config.emptyDescription}
        emptyAction={
          <Can do={config.draftCapability}>
            <Button asChild className="gap-1.5">
              <Link href={config.newHref}>
                <Plus className="h-4 w-4" />
                {config.newTitle}
              </Link>
            </Button>
          </Can>
        }
      />
    </div>
  );
}
