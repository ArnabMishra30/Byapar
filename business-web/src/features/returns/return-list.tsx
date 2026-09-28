"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, useListState, type Column } from "@/components/shared/data-table";
import { DateRangeFilter, type DateRangeValue } from "@/components/shared/date-range";
import { EntitySelect } from "@/components/shared/entity-select";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import { Can } from "@/components/shared/permission-gate";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/select-native";
import type { ReturnDoc } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { RETURN_CONFIG, type ReturnKind } from "./config";
import { PurchaseModuleTabs, SalesModuleTabs } from "./module-tabs";

/** Debounced copy of a value, so typing in search is one request, not ten. */
function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/**
 * Every sales return or purchase return, newest first.
 *
 * Amounts are the backend's grandTotal for the return. Nothing is added up here.
 */
export function ReturnList({ kind }: { kind: ReturnKind }) {
  const config = RETURN_CONFIG[kind];
  const list = useListState({ limit: 20 });
  const [range, setRange] = React.useState<DateRangeValue>({});
  const [status, setStatus] = React.useState("");
  const [customer, setCustomer] = React.useState<{ id: string; name: string } | null>(null);
  const search = useDebounced(list.search);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [config.queryKey, "list", list.page, range.fromDate, range.toDate, status, customer?.id, search],
    queryFn: () =>
      config.api.list({
        page: list.page,
        limit: list.limit,
        fromDate: range.fromDate,
        toDate: range.toDate,
        status: status || undefined,
        // The purchase-returns endpoint has no supplier filter; search covers
        // the supplier's name there instead.
        customerId: kind === "sale" ? customer?.id : undefined,
        search: search || undefined,
      }),
  });

  const numberOf = (row: ReturnDoc) => row.returnNumber || "Draft";

  const columns: Column<ReturnDoc>[] = [
    {
      header: "Return no.",
      cell: (row) => (
        <Link
          href={config.detailHref(row.id)}
          className="font-medium text-foreground hover:text-primary"
        >
          {numberOf(row)}
        </Link>
      ),
    },
    {
      header: "Date",
      cell: (row) => <span className="whitespace-nowrap">{formatDate(row.returnDate)}</span>,
    },
    {
      header: config.partyLabel,
      cell: (row) => (
        <span className="block max-w-[12rem] truncate">{config.partyOf(row)?.name ?? "—"}</span>
      ),
    },
    {
      header: config.sourceLabel,
      hideOnMobile: true,
      cell: (row) => {
        const source = config.sourceOf(row);
        return source ? (
          <Link href={config.sourceHref(source.id)} className="hover:text-primary">
            {source.number}
          </Link>
        ) : (
          "—"
        );
      },
    },
    {
      header: "Amount",
      numeric: true,
      cell: (row) => <Money value={row.grandTotal ?? "0"} />,
    },
    {
      header: "Status",
      cell: (row) => <StatusBadge status={row.status} />,
    },
  ];

  const newButton = (
    <Can do={config.draftCapability}>
      <Button asChild className="min-h-[44px] gap-1.5 sm:min-h-0">
        <Link href={config.newHref}>
          <Plus className="h-4 w-4" />
          {config.newTitle}
        </Link>
      </Button>
    </Can>
  );

  return (
    <div className="space-y-6">
      <PageHeader title={config.listTitle} description={config.listDescription} actions={newButton} />
      {kind === "sale" ? <SalesModuleTabs /> : <PurchaseModuleTabs />}

      <DataTable
        columns={columns}
        rows={data?.items}
        rowKey={(row) => row.id}
        isLoading={isLoading}
        error={error}
        onRetry={() => refetch()}
        search={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder={
          kind === "sale" ? "Return no., invoice no. or customer" : "Return no., bill no. or supplier"
        }
        mobileCard={(row) => (
          <Link href={config.detailHref(row.id)} className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{config.partyOf(row)?.name ?? "—"}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {formatDate(row.returnDate)} · {numberOf(row)}
                {config.sourceOf(row) ? ` · ${config.sourceOf(row)?.number}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <Money value={row.grandTotal ?? "0"} className="text-sm font-semibold" />
              <StatusBadge status={row.status} />
            </div>
          </Link>
        )}
        filters={
          <div className="grid w-full gap-3 sm:w-auto sm:grid-cols-[auto_auto_auto] sm:items-end">
            <DateRangeFilter
              value={range}
              onChange={(next) => {
                setRange(next);
                list.setPage(1);
              }}
            />
            {kind === "sale" ? (
              <div className="grid gap-1">
                <span className="text-[11px] text-muted-foreground">Customer</span>
                <div className="flex gap-1">
                  <div className="min-w-0 flex-1 sm:w-48 sm:flex-none">
                    <EntitySelect
                      kind="customer"
                      value={customer?.id}
                      valueLabel={customer?.name}
                      placeholder="All customers"
                      onChange={(id, name) => {
                        setCustomer({ id, name });
                        list.setPage(1);
                      }}
                    />
                  </div>
                  {customer ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Clear customer"
                      onClick={() => {
                        setCustomer(null);
                        list.setPage(1);
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
            <div className="grid gap-1">
              <label htmlFor={`${kind}-return-status`} className="text-[11px] text-muted-foreground">
                Status
              </label>
              <NativeSelect
                id={`${kind}-return-status`}
                className="sm:w-36"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  list.setPage(1);
                }}
              >
                <option value="">All</option>
                <option value="DRAFT">Draft</option>
                <option value="POSTED">Completed</option>
                <option value="CANCELLED">Cancelled</option>
              </NativeSelect>
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
        emptyAction={newButton}
      />
    </div>
  );
}
