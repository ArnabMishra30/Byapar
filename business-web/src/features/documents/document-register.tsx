"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { ModuleTabs, type ModuleTab } from "@/components/shared/module-tabs";
import { DataTable, useListState, type Column } from "@/components/shared/data-table";
import { DateRangeFilter, type DateRangeValue } from "@/components/shared/date-range";
import { Money } from "@/components/shared/money";
import { PaidDue } from "@/components/shared/paid-due";
import { StatusBadge } from "@/components/shared/status-badge";
import { NotAvailable, type UnavailableFeature } from "@/components/shared/not-available";
import { Can } from "@/components/shared/permission-gate";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn, formatDate } from "@/lib/utils";
import { DOC_CONFIG, type DocKind } from "./config";
import { DOC_TABS, fromDocument, parseTab, type DocRow, type DocTab } from "./doc-helpers";
import { DocRowActions } from "./doc-row-actions";
import { PartyFilter, type PartyValue } from "./party-filter";

/**
 * Every sale (or purchase) the shop has, in three piles:
 *
 *   Completed  posted documents, from the register report - the ONLY place the
 *              backend gives paid and due per document.
 *   Drafts     saved but not completed; nothing has moved yet.
 *   Cancelled  drafts that were abandoned.
 *
 * The tab lives in ?tab= so a link or the back button lands on the same pile.
 */
export function DocumentRegisterList({
  kind,
  tabs,
  unavailable,
}: {
  kind: DocKind;
  /** The module's sub-page tabs (Overview · Invoices · Returns ...). */
  tabs: ModuleTab[];
  /** Filters the shop may expect here that the backend cannot do yet. */
  unavailable: UnavailableFeature[];
}) {
  const config = DOC_CONFIG[kind];
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = parseTab(searchParams?.get("tab"));

  const list = useListState({ limit: 20 });
  const [range, setRange] = React.useState<DateRangeValue>({});
  const [party, setParty] = React.useState<PartyValue | null>(null);
  const [debouncedSearch, setDebouncedSearch] = React.useState("");

  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(list.search.trim()), 300);
    return () => clearTimeout(timer);
  }, [list.search]);

  const setTab = (next: DocTab) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (next === "completed") params.delete("tab");
    else params.set("tab", next);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname ?? config.listHref, { scroll: false });
    list.setPage(1);
  };

  const filters = {
    page: list.page,
    limit: list.limit,
    fromDate: range.fromDate,
    toDate: range.toDate,
    [config.partyField]: party?.id,
  };

  const completed = useQuery({
    queryKey: [kind, "register", filters],
    queryFn: () => config.register(filters),
    enabled: tab === "completed",
  });

  const status = DOC_TABS.find((t) => t.value === tab)?.status;
  const others = useQuery({
    queryKey: [kind, "list", status, debouncedSearch, filters],
    queryFn: async () => {
      const result = await config.api.list({ ...filters, status, search: debouncedSearch || undefined });
      return {
        rows: result.items.map((doc) => fromDocument(kind, doc)),
        pagination: result.pagination,
      };
    },
    enabled: tab !== "completed",
  });

  const active = tab === "completed" ? completed : others;
  const rows = active.data?.rows;
  const pagination = active.data?.pagination;

  const numberCell = (row: DocRow) => (
    <div className="min-w-0">
      <Link
        href={config.detailHref(row.id)}
        className="font-medium text-foreground hover:text-primary"
        onClick={(e) => e.stopPropagation()}
      >
        {row.number || (row.status === "DRAFT" ? "Draft" : "—")}
      </Link>
      {row.supplierBillNumber ? (
        <span className="block text-xs text-muted-foreground">Supplier bill {row.supplierBillNumber}</span>
      ) : null}
    </div>
  );

  const columns: Column<DocRow>[] = [
    { header: kind === "sale" ? "Invoice no." : "Bill no.", cell: numberCell },
    {
      header: "Date",
      cell: (row) => <span className="whitespace-nowrap">{formatDate(row.date)}</span>,
    },
    {
      header: config.partyLabel,
      cell: (row) => <span className="block max-w-[12rem] truncate">{row.partyName || "—"}</span>,
    },
    {
      header: "Amount",
      numeric: true,
      cell: (row) => <Money value={row.total} />,
    },
    ...(tab === "completed"
      ? ([
          {
            header: "Paid",
            numeric: true,
            hideOnMobile: true,
            cell: (row) => (row.paid != null ? <Money value={row.paid} className="text-success" /> : "—"),
          },
          {
            header: "Due",
            numeric: true,
            cell: (row) => (row.due != null ? <Money value={row.due} /> : "—"),
          },
          {
            header: "Status",
            cell: (row) => <StatusBadge status={row.paymentStatus ?? undefined} />,
          },
        ] as Column<DocRow>[])
      : ([
          {
            header: "Status",
            cell: (row) => <StatusBadge status={row.status} />,
          },
        ] as Column<DocRow>[])),
    {
      header: "Actions",
      className: "w-12 text-right",
      cell: (row) => <DocRowActions kind={kind} row={row} />,
    },
  ];

  const newButton = (
    <Can do={config.draftCapability}>
      <Button asChild className="gap-1.5">
        <Link href={config.newHref}>
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">{config.newTitle}</span>
          <span className="sm:hidden">New</span>
        </Link>
      </Button>
    </Can>
  );

  const emptyByTab: Record<DocTab, { title: string; description: string }> = {
    completed: {
      title: range.fromDate || party ? "Nothing completed in this filter" : config.emptyTitle,
      description:
        range.fromDate || party
          ? "Try a wider date range, or show everyone."
          : `Completed ${config.noun.toLowerCase()}s show here with what is paid and what is due.`,
    },
    drafts: {
      title: "No drafts waiting",
      description: "Anything saved but not completed yet shows here.",
    },
    cancelled: {
      title: "Nothing cancelled",
      description: "Drafts that were cancelled show here for the record.",
    },
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <PageHeader title={config.listTitle} description={config.listDescription} actions={newButton} />
        <ModuleTabs tabs={tabs} />
      </div>

      {/* Which pile: plain buttons, 44px tall, that scroll sideways on a
          narrow phone rather than wrap. */}
      <div role="tablist" aria-label="Which documents" className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
        <div className="inline-flex gap-1 rounded-lg bg-muted p-1">
          {DOC_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={tab === t.value}
              onClick={() => setTab(t.value)}
              className={cn(
                "min-h-[44px] whitespace-nowrap rounded-md px-4 text-sm font-medium transition-colors sm:min-h-[36px]",
                tab === t.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <Card>
        <CardContent className="grid gap-3 p-3 sm:p-4 lg:grid-cols-2">
          <DateRangeFilter
            value={range}
            onChange={(next) => {
              setRange(next);
              list.setPage(1);
            }}
          />
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{config.partyLabel}</p>
            <PartyFilter
              kind={config.partyKind}
              value={party}
              onChange={(next) => {
                setParty(next);
                list.setPage(1);
              }}
            />
          </div>
        </CardContent>
      </Card>

      {tab === "completed" && completed.data ? (
        <p className="text-sm text-muted-foreground">
          {completed.data.totals.count} completed · total{" "}
          <Money value={completed.data.totals.total} className="font-semibold text-foreground" />
          {range.fromDate || range.toDate ? " in this period" : ""}
        </p>
      ) : null}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        isLoading={active.isLoading}
        error={active.error}
        onRetry={() => active.refetch()}
        // Search is a feature of the document list, not of the register report,
        // so it is offered only where the backend actually searches.
        search={tab === "completed" ? undefined : list.search}
        onSearchChange={tab === "completed" ? undefined : list.setSearch}
        searchPlaceholder={kind === "sale" ? "Search invoice no. or customer" : "Search bill no. or supplier"}
        onRowClick={(row) => router.push(config.detailHref(row.id))}
        mobileCard={(row) => (
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-semibold">{row.partyName || "—"}</p>
                <StatusBadge status={tab === "completed" ? (row.paymentStatus ?? undefined) : row.status} />
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {row.number || "Draft"} · {formatDate(row.date)}
              </p>
              {tab === "completed" ? (
                <PaidDue total={row.total} paid={row.paid} due={row.due} />
              ) : (
                <Money value={row.total} className="text-sm font-semibold" />
              )}
            </div>
            <DocRowActions kind={kind} row={row} />
          </div>
        )}
        pagination={
          pagination
            ? {
                page: pagination.page,
                totalPages: pagination.totalPages,
                total: pagination.total,
                onPageChange: list.setPage,
              }
            : undefined
        }
        emptyTitle={emptyByTab[tab].title}
        emptyDescription={emptyByTab[tab].description}
        emptyAction={
          tab === "completed" && (range.fromDate || party) ? (
            <Button
              variant="outline"
              onClick={() => {
                setRange({});
                setParty(null);
                list.setPage(1);
              }}
            >
              Clear filters
            </Button>
          ) : (
            newButton
          )
        }
      />

      {tab === "completed" ? (
        <p className="text-xs text-muted-foreground">
          Search by number works on the Drafts and Cancelled tabs. For completed{" "}
          {kind === "sale" ? "sales" : "purchases"}, pick a {config.partyLabel.toLowerCase()} and a date range.
        </p>
      ) : null}

      <NotAvailable features={unavailable} />
    </div>
  );
}
