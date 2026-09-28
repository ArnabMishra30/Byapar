"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, FileText, HandCoins, IndianRupee, Truck, X } from "lucide-react";
import { creditBookApi, dueListsApi, type AgeingBucket, type CreditPartyRow } from "@/lib/api";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { DataTable, useListState, type Column } from "@/components/shared/data-table";
import { EntitySelect } from "@/components/shared/entity-select";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import { Can } from "@/components/shared/permission-gate";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/select-native";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DETAIL_ROUTES, ROUTES } from "@/lib/constants";
import { cn, formatDate } from "@/lib/utils";
import { PurchaseModuleTabs } from "@/features/returns/module-tabs";
import { daysFromToday, daysPastDue, describeDue } from "@/features/returns/helpers";

/** One bill still owed, exactly as GET /supplier-payables returns it. */
interface PayableRow {
  id: string;
  supplier: { id: string; name: string };
  purchase: {
    id: string;
    purchaseNumber: string;
    invoiceNumber?: string | null;
    invoiceDate?: string | null;
  } | null;
  source?: "PURCHASE" | "OPENING_BALANCE";
  originalAmount: string;
  creditAmount?: string;
  paidAmount: string;
  outstandingAmount: string;
  dueDate: string | null;
  status: string;
}

const AGE_LABEL: Record<AgeingBucket, string> = {
  UNDATED: "No date",
  "0-30": "Under 30 days",
  "31-60": "31–60 days",
  "61-90": "61–90 days",
  "90+": "Over 90 days",
};

/** Pay link per the cross-module contract: the Money Paid page prefills the supplier. */
const payHref = (supplierId: string) => `${ROUTES.moneyPaid}?supplierId=${encodeURIComponent(supplierId)}`;

/**
 * "You owe suppliers" - the purchase-side credit book.
 *
 * Two views of the same backend ledger:
 *   By supplier  one row per supplier (GET /credit/payables)
 *   Bills due    one row per unpaid bill, soonest due first (GET /supplier-payables)
 *
 * All money is the backend's. The only arithmetic here is counting days
 * between a due date and today.
 */
export function SupplierPayables() {
  const [tab, setTab] = React.useState("suppliers");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Supplier Payables"
        description="How much you owe each supplier, and which bills are due."
      />
      <PurchaseModuleTabs />

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 sm:inline-grid sm:w-auto">
          <TabsTrigger value="suppliers" className="min-h-[40px]">
            By supplier
          </TabsTrigger>
          <TabsTrigger value="bills" className="min-h-[40px]">
            Bills due
          </TabsTrigger>
        </TabsList>
        <TabsContent value="suppliers" className="space-y-4">
          <BySupplier />
        </TabsContent>
        <TabsContent value="bills" className="space-y-4">
          <BillsDue />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// --- by supplier -------------------------------------------------------------

function BySupplier() {
  const [overdueOnly, setOverdueOnly] = React.useState(false);
  const [search, setSearch] = React.useState("");

  // The headline figures always describe ALL suppliers, so they are read from
  // the unfiltered call even while the table shows overdue ones only.
  const all = useQuery({
    queryKey: ["credit-book", "payables", false],
    queryFn: () => creditBookApi.suppliers(),
  });
  const filtered = useQuery({
    queryKey: ["credit-book", "payables", overdueOnly],
    queryFn: () => creditBookApi.suppliers({ overdueOnly }),
  });

  const summary = all.data?.summary;
  // Narrowing by name is a filter over rows the backend already returned, not a
  // calculation.
  const needle = search.trim().toLowerCase();
  const rows = (filtered.data?.suppliers ?? []).filter(
    (row) => !needle || row.name.toLowerCase().includes(needle) || (row.phone ?? "").includes(needle),
  );

  const columns: Column<CreditPartyRow>[] = [
    {
      header: "Supplier",
      cell: (row) => (
        <div className="min-w-0">
          <Link
            href={DETAIL_ROUTES.supplier(row.partyId)}
            className="block max-w-[14rem] truncate font-medium hover:text-primary"
          >
            {row.name}
          </Link>
          {row.phone ? <span className="text-xs text-muted-foreground">{row.phone}</span> : null}
        </div>
      ),
    },
    {
      header: "You owe",
      numeric: true,
      cell: (row) => <Money value={row.outstanding} className="font-semibold" />,
    },
    {
      header: "Overdue",
      numeric: true,
      cell: (row) =>
        row.isOverdue ? (
          <Money value={row.overdue} className="text-destructive" />
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      header: "Oldest bill",
      hideOnMobile: true,
      cell: (row) => (
        <div className="text-sm">
          <span className="block">{row.oldestDocumentNumber ?? "—"}</span>
          <span className="text-xs text-muted-foreground">
            {row.oldestDocumentDate ? `${formatDate(row.oldestDocumentDate)} · ` : ""}
            {AGE_LABEL[row.ageingBucket] ?? row.ageingBucket}
          </span>
        </div>
      ),
    },
    {
      header: "Last payment",
      hideOnMobile: true,
      cell: (row) =>
        row.lastPayment ? (
          <div className="text-sm">
            <Money value={row.lastPayment.amount} />
            <span className="block text-xs text-muted-foreground">{formatDate(row.lastPayment.date)}</span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">No payment yet</span>
        ),
    },
    {
      header: "",
      cell: (row) => <SupplierActions row={row} />,
    },
  ];

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="You owe suppliers"
          value={<Money value={summary?.total ?? "0"} />}
          icon={IndianRupee}
          tone="dues"
          isLoading={all.isLoading}
        />
        <StatCard
          label="Overdue"
          value={<Money value={summary?.overdue ?? "0"} />}
          hint={summary ? `${summary.overduePartyCount} supplier${summary.overduePartyCount === 1 ? "" : "s"}` : undefined}
          icon={AlertTriangle}
          tone="credit"
          isLoading={all.isLoading}
        />
        <StatCard
          label="Not yet due"
          value={<Money value={summary?.notYetDue ?? "0"} />}
          icon={CalendarClock}
          isLoading={all.isLoading}
        />
        <StatCard
          label="Suppliers to pay"
          value={summary?.partyCount ?? 0}
          icon={Truck}
          isLoading={all.isLoading}
        />
      </div>

      <DataTable
        columns={columns}
        rows={filtered.data ? rows : undefined}
        rowKey={(row) => row.partyId}
        isLoading={filtered.isLoading}
        error={filtered.error ?? all.error}
        onRetry={() => {
          all.refetch();
          filtered.refetch();
        }}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search supplier"
        filters={
          <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm sm:min-h-0">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={overdueOnly}
              onChange={(e) => setOverdueOnly(e.target.checked)}
            />
            Overdue only
          </label>
        }
        mobileCard={(row) => (
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <Link href={DETAIL_ROUTES.supplier(row.partyId)} className="block truncate text-sm font-medium">
                  {row.name}
                </Link>
                <p className="truncate text-xs text-muted-foreground">
                  {row.oldestDocumentDate ? `Oldest ${formatDate(row.oldestDocumentDate)} · ` : ""}
                  {AGE_LABEL[row.ageingBucket] ?? row.ageingBucket}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <Money value={row.outstanding} className="text-sm font-semibold" />
                {row.isOverdue ? (
                  <p className="text-[11px] text-destructive">
                    Overdue <Money value={row.overdue} />
                  </p>
                ) : null}
              </div>
            </div>
            <SupplierActions row={row} />
          </div>
        )}
        emptyTitle={overdueOnly ? "No overdue bills" : "You don't owe any supplier"}
        emptyDescription={
          overdueOnly
            ? "Every unpaid supplier bill is still within its due date."
            : "Record a purchase on credit and it will show here until you pay it."
        }
        emptyAction={
          overdueOnly ? (
            <Button variant="outline" onClick={() => setOverdueOnly(false)}>
              Show all suppliers
            </Button>
          ) : (
            <Can do="purchases.draft">
              <Button asChild>
                <Link href={ROUTES.newPurchase}>New purchase</Link>
              </Button>
            </Can>
          )
        }
      />
    </>
  );
}

function SupplierActions({ row }: { row: CreditPartyRow }) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Can do="money.pay">
        <Button asChild size="sm" className="min-h-[44px] gap-1.5 sm:min-h-0">
          <Link href={payHref(row.partyId)}>
            <HandCoins className="h-4 w-4" />
            Pay
          </Link>
        </Button>
      </Can>
      <Button asChild size="sm" variant="outline" className="min-h-[44px] gap-1.5 sm:min-h-0">
        <Link href={DETAIL_ROUTES.supplier(row.partyId)}>
          <FileText className="h-4 w-4" />
          Statement
        </Link>
      </Button>
    </div>
  );
}

// --- bills due ---------------------------------------------------------------

type DueWindow = "all" | "overdue" | "7" | "30";

function BillsDue() {
  const list = useListState({ limit: 20 });
  const [dueWindow, setDueWindow] = React.useState<DueWindow>("all");
  const [supplier, setSupplier] = React.useState<{ id: string; name: string } | null>(null);

  // "Overdue" = due before today; "due soon" = due by N days from now. The
  // backend filters on dueDateTo; only the cut-off date is worked out here.
  const dueDateTo =
    dueWindow === "overdue" ? daysFromToday(-1) : dueWindow === "7" ? daysFromToday(7) : dueWindow === "30" ? daysFromToday(30) : undefined;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["supplier-payables", "due", list.page, dueDateTo, supplier?.id],
    queryFn: () =>
      dueListsApi.payables<PayableRow>({
        onlyOutstanding: true,
        page: list.page,
        limit: list.limit,
        dueDateTo,
        supplierId: supplier?.id,
      }),
  });

  const billNumber = (row: PayableRow) =>
    row.purchase
      ? row.purchase.invoiceNumber
        ? `${row.purchase.invoiceNumber}`
        : row.purchase.purchaseNumber
      : "Opening balance";

  const dueLabel = (row: PayableRow) => {
    const days = daysPastDue(row.dueDate);
    return (
      <span className={cn("whitespace-nowrap text-xs", days !== null && days > 0 ? "font-medium text-destructive" : "text-muted-foreground")}>
        {describeDue(days)}
      </span>
    );
  };

  const columns: Column<PayableRow>[] = [
    {
      header: "Supplier",
      cell: (row) => (
        <Link href={DETAIL_ROUTES.supplier(row.supplier.id)} className="block max-w-[12rem] truncate font-medium hover:text-primary">
          {row.supplier.name}
        </Link>
      ),
    },
    {
      header: "Bill no.",
      cell: (row) =>
        row.purchase ? (
          <Link href={DETAIL_ROUTES.purchase(row.purchase.id)} className="hover:text-primary">
            {billNumber(row)}
          </Link>
        ) : (
          <span className="text-muted-foreground">{billNumber(row)}</span>
        ),
    },
    {
      header: "Bill date",
      hideOnMobile: true,
      cell: (row) => <span className="whitespace-nowrap">{formatDate(row.purchase?.invoiceDate ?? null)}</span>,
    },
    {
      header: "Due date",
      cell: (row) => (
        <div>
          <span className="block whitespace-nowrap">{formatDate(row.dueDate)}</span>
          {dueLabel(row)}
        </div>
      ),
    },
    { header: "Bill amount", numeric: true, hideOnMobile: true, cell: (row) => <Money value={row.originalAmount} /> },
    { header: "Returned", numeric: true, hideOnMobile: true, cell: (row) => <Money value={row.creditAmount ?? "0"} /> },
    { header: "Paid", numeric: true, hideOnMobile: true, cell: (row) => <Money value={row.paidAmount} /> },
    {
      header: "You owe",
      numeric: true,
      cell: (row) => <Money value={row.outstandingAmount} className="font-semibold" />,
    },
    { header: "Status", cell: (row) => <StatusBadge status={row.status} /> },
  ];

  return (
    <DataTable
      columns={columns}
      rows={data?.items}
      rowKey={(row) => row.id}
      isLoading={isLoading}
      error={error}
      onRetry={() => refetch()}
      filters={
        <div className="grid w-full gap-3 sm:w-auto sm:grid-cols-2 sm:items-end">
          <div className="grid gap-1">
            <label htmlFor="bills-due-window" className="text-[11px] text-muted-foreground">
              Due
            </label>
            <NativeSelect
              id="bills-due-window"
              value={dueWindow}
              onChange={(e) => {
                setDueWindow(e.target.value as DueWindow);
                list.setPage(1);
              }}
            >
              <option value="all">All unpaid bills</option>
              <option value="overdue">Overdue</option>
              <option value="7">Due in the next 7 days</option>
              <option value="30">Due in the next 30 days</option>
            </NativeSelect>
          </div>
          <div className="grid gap-1">
            <span className="text-[11px] text-muted-foreground">Supplier</span>
            <div className="flex gap-1">
              <div className="min-w-0 flex-1 sm:w-48 sm:flex-none">
                <EntitySelect
                  kind="supplier"
                  value={supplier?.id}
                  valueLabel={supplier?.name}
                  placeholder="All suppliers"
                  onChange={(id, name) => {
                    setSupplier({ id, name });
                    list.setPage(1);
                  }}
                />
              </div>
              {supplier ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Clear supplier"
                  onClick={() => {
                    setSupplier(null);
                    list.setPage(1);
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      }
      mobileCard={(row) => (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{row.supplier.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {billNumber(row)} · Due {formatDate(row.dueDate)}
            </p>
            {dueLabel(row)}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Money value={row.outstandingAmount} className="text-sm font-semibold" />
            <span className="text-[11px] text-muted-foreground">
              of <Money value={row.originalAmount} />
            </span>
            <StatusBadge status={row.status} />
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
      emptyTitle={dueWindow === "all" ? "No unpaid supplier bills" : "No bills in this window"}
      emptyDescription={
        dueWindow === "all"
          ? "Every supplier bill is paid. Bills bought on credit show here until you pay them."
          : "Try a wider window, or show all unpaid bills."
      }
      emptyAction={
        dueWindow !== "all" ? (
          <Button variant="outline" onClick={() => setDueWindow("all")}>
            Show all unpaid bills
          </Button>
        ) : undefined
      }
    />
  );
}
