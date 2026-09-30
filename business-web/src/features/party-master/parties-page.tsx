"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { partiesApi, type PartyListRow, type PartyRelationship } from "@/lib/api";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, useListState, type Column } from "@/components/shared/data-table";
import { Money } from "@/components/shared/money";
import { Can } from "@/components/shared/permission-gate";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/select-native";
import { DETAIL_ROUTES, ROUTES } from "@/lib/constants";
import { cn, formatDate } from "@/lib/utils";
import { RelationshipBadge } from "./relationship-badge";

type Filter = "ALL" | PartyRelationship;

const FILTERS: { value: Filter; label: string; countKey: "total" | "customers" | "suppliers" | "both" }[] = [
  { value: "ALL", label: "All", countKey: "total" },
  { value: "CUSTOMER", label: "Customers", countKey: "customers" },
  { value: "SUPPLIER", label: "Suppliers", countKey: "suppliers" },
  { value: "BOTH", label: "Both", countKey: "both" },
];

/**
 * Everyone the shop deals with, in one list.
 *
 * "Owes you" and "You owe" are two columns, never one: a party that is both a
 * customer and a supplier has two separate balances, each straight from its
 * own ledger. A dash means they are not that kind of party at all.
 */
export function PartiesPage() {
  const router = useRouter();
  const list = useListState({ limit: 20 });
  const [filter, setFilter] = React.useState<Filter>("ALL");
  const [active, setActive] = React.useState<"true" | "false" | "">("true");

  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(list.search.trim()), 300);
    return () => clearTimeout(timer);
  }, [list.search]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["parties", "list", list.page, debouncedSearch, filter, active],
    queryFn: () =>
      partiesApi.list({
        page: list.page,
        limit: list.limit,
        search: debouncedSearch || undefined,
        relationship: filter,
        isActive: active || undefined,
      }),
  });

  const counts = useQuery({ queryKey: ["parties", "summary"], queryFn: () => partiesApi.summary() });

  const side = (value: string | null, tone: "in" | "out") =>
    value == null ? (
      <span className="text-muted-foreground">—</span>
    ) : (
      <Money
        value={value}
        className={cn("font-semibold", Number(value) > 0 && (tone === "in" ? "text-success" : "text-warning"))}
      />
    );

  const columns: Column<PartyListRow>[] = [
    {
      header: "Party",
      cell: (row) => (
        <Link href={DETAIL_ROUTES.party(row.id)} className="font-medium text-foreground hover:text-primary">
          {row.name}
          {row.contactPerson ? (
            <span className="block text-xs font-normal text-muted-foreground">{row.contactPerson}</span>
          ) : null}
        </Link>
      ),
    },
    { header: "Mobile", cell: (row) => row.phone || <span className="text-muted-foreground">—</span> },
    { header: "Type", cell: (row) => <RelationshipBadge relationship={row.relationship} /> },
    { header: "Owes you", numeric: true, cell: (row) => side(row.receivable, "in") },
    { header: "You owe", numeric: true, cell: (row) => side(row.payable, "out") },
    {
      header: "Last activity",
      hideOnMobile: true,
      cell: (row) =>
        row.lastTransactionDate ? (
          <span className="whitespace-nowrap">{formatDate(row.lastTransactionDate)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      header: "Status",
      hideOnMobile: true,
      cell: (row) =>
        row.isActive ? <span className="text-xs text-muted-foreground">Active</span> : <span className="text-xs text-muted-foreground">Inactive</span>,
    },
    {
      header: "",
      hideOnMobile: true,
      cell: (row) => (
        <Button asChild variant="ghost" size="sm">
          <Link href={DETAIL_ROUTES.party(row.id)}>Open</Link>
        </Button>
      ),
    },
  ];

  const addButton = (full = false) => (
    <Button asChild className="gap-1.5">
      <Link href={ROUTES.newParty} aria-label="Add party">
        <Plus className="h-4 w-4" />
        <span className={full ? "" : "hidden sm:inline"}>Add party</span>
        {full ? null : <span className="sm:hidden">Add</span>}
      </Link>
    </Button>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Parties"
        description="Everyone you sell to or buy from. A party can be a customer, a supplier, or both."
        actions={<Can do="parties.manage">{addButton()}</Can>}
      />

      {/* A scrollable strip on a phone, so four filters never wrap awkwardly. */}
      <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
        <div className="inline-flex gap-1 rounded-lg border bg-card p-1" role="tablist" aria-label="Show">
          {FILTERS.map((option) => {
            const selected = filter === option.value;
            const count = counts.data?.[option.countKey];
            return (
              <button
                key={option.value}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => {
                  setFilter(option.value);
                  list.setPage(1);
                }}
                className={cn(
                  "min-h-[36px] whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors",
                  selected ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {option.label}
                {count != null ? <span className="ml-1.5 tabular opacity-80">{count}</span> : null}
              </button>
            );
          })}
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={data?.items}
        rowKey={(row) => row.id}
        isLoading={isLoading}
        error={error}
        onRetry={() => refetch()}
        search={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search name, mobile, email or GSTIN…"
        filters={
          <NativeSelect
            aria-label="Status"
            className="w-full sm:w-40"
            value={active}
            onChange={(event) => {
              setActive(event.target.value as "true" | "false" | "");
              list.setPage(1);
            }}
          >
            <option value="true">Active</option>
            <option value="false">Inactive</option>
            <option value="">All</option>
          </NativeSelect>
        }
        onRowClick={(row) => router.push(DETAIL_ROUTES.party(row.id))}
        mobileCard={(row) => (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <p className="truncate text-sm font-medium">{row.name}</p>
                <RelationshipBadge relationship={row.relationship} />
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.phone || "No mobile"}</p>
              {!row.isActive ? <p className="text-xs text-muted-foreground">Inactive</p> : null}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-0.5 text-xs">
              {row.receivable != null ? (
                <span>
                  Owes you <Money value={row.receivable} className="font-semibold" />
                </span>
              ) : null}
              {row.payable != null ? (
                <span>
                  You owe <Money value={row.payable} className="font-semibold" />
                </span>
              ) : null}
            </div>
          </div>
        )}
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
        emptyTitle={filter === "ALL" && active === "true" ? "No parties yet" : "No parties here"}
        emptyDescription={
          filter === "ALL" && active === "true"
            ? "Add the people and businesses you sell to and buy from."
            : undefined
        }
        emptyAction={filter === "ALL" && active === "true" ? <Can do="parties.manage">{addButton(true)}</Can> : undefined}
      />
    </div>
  );
}
