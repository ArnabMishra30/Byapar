"use client";

import * as React from "react";
import Link from "next/link";
import { useQueries } from "@tanstack/react-query";
import { AlertTriangle, Info } from "lucide-react";
import {
  billsApi,
  expensesApi,
  moneyInApi,
  moneyOutApi,
  purchaseReturnApi,
  purchasesApi,
  salesApi,
  salesReturnApi,
  type ListResult,
} from "@/lib/api";
import { DETAIL_ROUTES, ROUTES } from "@/lib/constants";
import { formatDate, formatDateTime } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import { NotAvailable } from "@/components/shared/not-available";
import { NativeSelect } from "@/components/ui/select-native";
import { Button } from "@/components/ui/button";

/**
 * Recycle bin.
 *
 * NOTHING HERE WAS DELETED, and nothing can be. The backend has no delete for
 * a business record: a draft is cancelled, a posted expense is reversed by an
 * opposite entry, and a posted sale or purchase is undone with a return. This
 * screen gathers the cancelled and reversed records from each list, using
 * each list's own status filter, so they can be found again.
 *
 * Each source loads on its own. If one list fails, the others still show and
 * the failure is named, rather than one error blanking the whole page.
 */

type Raw = Record<string, unknown>;

/** How many of the most recent records to fetch per type (the backend max). */
const PER_TYPE = 100;

interface BinRow {
  key: string;
  type: string;
  typeKey: string;
  number: string;
  party: string | null;
  amount: string | null;
  status: string;
  /** When it was cancelled/reversed if the backend recorded it, else last change. */
  when: string | null;
  whenIsExact: boolean;
  by: string | null;
  reason: string | null;
  href: string;
}

interface Source {
  key: string;
  label: string;
  load: () => Promise<ListResult<Raw>>;
  toRow: (raw: Raw) => BinRow;
}

const str = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const nameOf = (value: unknown): string | null =>
  value && typeof value === "object" ? str((value as Raw).name) : null;

function base(source: { key: string; label: string }, raw: Raw, overrides: Partial<BinRow>): BinRow {
  const exact = str(raw.cancelledAt);
  return {
    key: `${source.key}-${String(raw.id)}`,
    type: source.label,
    typeKey: source.key,
    number: "—",
    party: null,
    amount: null,
    status: str(raw.status) ?? "CANCELLED",
    when: exact ?? str(raw.updatedAt),
    whenIsExact: Boolean(exact),
    by: nameOf(raw.cancelledBy),
    reason: null,
    href: ROUTES.dashboard,
    ...overrides,
  };
}

const asRaw = <T,>(load: Promise<ListResult<T>>) => load as unknown as Promise<ListResult<Raw>>;

const SOURCES: Source[] = [
  {
    key: "sale",
    label: "Sale",
    load: () => asRaw(salesApi.list({ status: "CANCELLED", limit: PER_TYPE })),
    toRow(raw) {
      return base(this, raw, {
        number: str(raw.invoiceNumber) ?? "Draft",
        party: nameOf(raw.customer),
        amount: str(raw.grandTotal),
        href: DETAIL_ROUTES.sale(String(raw.id)),
      });
    },
  },
  {
    key: "purchase",
    label: "Purchase",
    load: () => asRaw(purchasesApi.list({ status: "CANCELLED", limit: PER_TYPE })),
    toRow(raw) {
      return base(this, raw, {
        number: str(raw.purchaseNumber) ?? "Draft",
        party: nameOf(raw.supplier),
        amount: str(raw.grandTotal),
        href: DETAIL_ROUTES.purchase(String(raw.id)),
      });
    },
  },
  {
    key: "salesReturn",
    label: "Sales return",
    load: () => asRaw(salesReturnApi.list({ status: "CANCELLED", limit: PER_TYPE })),
    toRow(raw) {
      return base(this, raw, {
        number: str(raw.returnNumber) ?? "Draft",
        party: nameOf(raw.customer),
        amount: str(raw.grandTotal),
        href: DETAIL_ROUTES.salesReturn(String(raw.id)),
      });
    },
  },
  {
    key: "purchaseReturn",
    label: "Purchase return",
    load: () => asRaw(purchaseReturnApi.list({ status: "CANCELLED", limit: PER_TYPE })),
    toRow(raw) {
      return base(this, raw, {
        number: str(raw.returnNumber) ?? "Draft",
        party: nameOf(raw.supplier),
        amount: str(raw.grandTotal),
        href: DETAIL_ROUTES.purchaseReturn(String(raw.id)),
      });
    },
  },
  {
    key: "moneyIn",
    label: "Money received",
    load: () => asRaw(moneyInApi.list({ status: "CANCELLED", limit: PER_TYPE })),
    toRow(raw) {
      return base(this, raw, {
        number: str(raw.paymentNumber) ?? "Draft",
        party: nameOf(raw.customer),
        amount: str(raw.amount),
        href: ROUTES.moneyReceived,
      });
    },
  },
  {
    key: "moneyOut",
    label: "Money paid",
    load: () => asRaw(moneyOutApi.list({ status: "CANCELLED", limit: PER_TYPE })),
    toRow(raw) {
      return base(this, raw, {
        number: str(raw.paymentNumber) ?? "Draft",
        party: nameOf(raw.supplier),
        amount: str(raw.amount),
        href: ROUTES.moneyPaid,
      });
    },
  },
  {
    key: "expenseCancelled",
    label: "Expense",
    load: () => asRaw(expensesApi.list({ status: "CANCELLED", limit: PER_TYPE })),
    toRow(raw) {
      return base(this, raw, {
        number: str(raw.expenseNumber) ?? "Draft",
        party: nameOf(raw.category),
        amount: str(raw.amount),
        href: ROUTES.expenses,
      });
    },
  },
  {
    key: "expenseReversed",
    label: "Expense (reversed)",
    load: () => asRaw(expensesApi.list({ status: "REVERSED", limit: PER_TYPE })),
    toRow(raw) {
      const exact = str(raw.reversedAt);
      return base(this, raw, {
        number: str(raw.expenseNumber) ?? "—",
        party: nameOf(raw.category),
        amount: str(raw.amount),
        when: exact ?? str(raw.updatedAt),
        whenIsExact: Boolean(exact),
        by: nameOf(raw.reversedBy),
        href: ROUTES.expenses,
      });
    },
  },
  {
    key: "bill",
    label: "Uploaded bill",
    load: () => asRaw(billsApi.list({ status: "CANCELLED", limit: PER_TYPE })),
    toRow(raw) {
      const file = raw.file as Raw | undefined;
      return base(this, raw, {
        number: str(file?.name) ?? "Bill",
        party: raw.direction === "OUT" ? "Sales bill" : raw.direction === "IN" ? "Purchase bill" : null,
        reason: str(raw.cancelReason),
        // Bills do not record who cancelled them.
        by: null,
        href: DETAIL_ROUTES.bill(String(raw.id)),
      });
    },
  },
];

export function RecycleBin() {
  const [typeFilter, setTypeFilter] = React.useState("all");

  const results = useQueries({
    queries: SOURCES.map((source) => ({
      queryKey: ["recycle-bin", source.key],
      queryFn: source.load,
    })),
  });

  const isLoading = results.some((result) => result.isLoading);
  const failed = SOURCES.filter((_, index) => results[index].error);
  const truncated = SOURCES.filter((_, index) => {
    const data = results[index].data;
    return data?.pagination ? data.pagination.total > data.items.length : false;
  });

  const rows = React.useMemo(() => {
    const all: BinRow[] = [];
    SOURCES.forEach((source, index) => {
      if (typeFilter !== "all" && typeFilter !== source.key) return;
      for (const raw of results[index].data?.items ?? []) all.push(source.toRow(raw));
    });
    // Most recent first. Sorting by a date string, not by any amount.
    return all.sort((a, b) => (b.when ?? "").localeCompare(a.when ?? ""));
  }, [results, typeFilter]);

  const columns: Column<BinRow>[] = [
    {
      header: "Type",
      cell: (row) => (
        <span className="block">
          <span className="block font-medium">{row.type}</span>
          <StatusBadge status={row.status} />
        </span>
      ),
    },
    {
      header: "Number / name",
      cell: (row) => (
        <span className="block">
          <span className="block max-w-[14rem] truncate font-medium">{row.number}</span>
          {row.party ? <span className="block text-xs text-muted-foreground">{row.party}</span> : null}
        </span>
      ),
    },
    {
      header: "Amount",
      numeric: true,
      hideOnMobile: true,
      cell: (row) => (row.amount ? <Money value={row.amount} /> : <span className="text-muted-foreground">—</span>),
    },
    {
      header: "When",
      cell: (row) => (
        <span className="block">
          <span className="block">{row.whenIsExact ? formatDateTime(row.when) : formatDate(row.when)}</span>
          {!row.whenIsExact ? <span className="block text-xs text-muted-foreground">Last changed</span> : null}
        </span>
      ),
    },
    { header: "By", hideOnMobile: true, cell: (row) => row.by ?? "—" },
    {
      header: "Reason",
      hideOnMobile: true,
      cell: (row) => <span className="block max-w-[14rem] truncate">{row.reason ?? "—"}</span>,
    },
    {
      header: "",
      cell: (row) => (
        <Button asChild variant="outline" size="sm">
          <Link href={row.href}>Open</Link>
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Recycle bin" description="Cancelled and reversed records, kept for your records." />

      <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        <p>
          Nothing is ever deleted from your books. Cancelled drafts and reversed entries are kept here for your
          records. Posted sales and purchases are undone with a return, not deleted.
        </p>
      </div>

      {failed.length > 0 ? (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-foreground">Some records could not be loaded</p>
            <p className="text-muted-foreground">
              {failed.map((source) => source.label).join(", ")}. The rest are shown below.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => results.forEach((result) => (result.error ? result.refetch() : null))}
          >
            Try again
          </Button>
        </div>
      ) : null}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.key}
        isLoading={isLoading && rows.length === 0}
        filters={
          <label className="flex w-full items-center gap-2 sm:w-64">
            <span className="shrink-0 text-sm text-muted-foreground">Show</span>
            <NativeSelect aria-label="Type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="all">Everything</option>
              {SOURCES.map((source) => (
                <option key={source.key} value={source.key}>
                  {source.label}
                </option>
              ))}
            </NativeSelect>
          </label>
        }
        mobileCard={(row) => (
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{row.number}</p>
                <p className="text-xs text-muted-foreground">
                  {row.type}
                  {row.party ? ` · ${row.party}` : ""}
                </p>
              </div>
              <StatusBadge status={row.status} />
            </div>
            <p className="text-xs text-muted-foreground">
              {row.whenIsExact ? formatDateTime(row.when) : `Last changed ${formatDate(row.when)}`}
              {row.by ? ` · by ${row.by}` : ""}
            </p>
            {row.reason ? <p className="text-xs text-muted-foreground">Reason: {row.reason}</p> : null}
            <div className="flex items-center justify-between gap-2">
              {row.amount ? <Money value={row.amount} className="font-semibold" /> : <span />}
              <Button asChild variant="outline" size="sm">
                <Link href={row.href}>Open</Link>
              </Button>
            </div>
          </div>
        )}
        emptyTitle="The recycle bin is empty"
        emptyDescription="Nothing has been cancelled or reversed. When something is, you will find it here."
      />

      {truncated.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Showing the latest {PER_TYPE} of each type. For older {truncated.map((s) => s.label.toLowerCase()).join(", ")},
          filter by “Cancelled” on that type&apos;s own list.
        </p>
      ) : null}

      <NotAvailable
        features={[
          {
            title: "Restore a cancelled draft",
            description: "A cancelled record cannot be brought back. Create it again instead.",
          },
          {
            title: "Delete permanently",
            description: "Business records are never deleted, so your books always add up.",
          },
        ]}
      />
    </div>
  );
}
