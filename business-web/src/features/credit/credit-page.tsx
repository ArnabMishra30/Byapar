"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  AlarmClock,
  ArrowDownLeft,
  ArrowUpRight,
  BookOpen,
  CalendarClock,
  ExternalLink,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import {
  creditApi,
  creditBookApi,
  dueListsApi,
  type CreditPartyRow,
} from "@/lib/api";
import { PageHeader } from "@/components/shared/page-header";
import { ModuleTabs } from "@/components/shared/module-tabs";
import { StatCard } from "@/components/shared/stat-card";
import { DataTable, type Column } from "@/components/shared/data-table";
import { Money } from "@/components/shared/money";
import { PaidDue } from "@/components/shared/paid-due";
import { Can } from "@/components/shared/permission-gate";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { DETAIL_ROUTES, ROUTES } from "@/lib/constants";
import { formatDate } from "@/lib/utils";
import { OverdueBadge } from "@/features/parties/party-tabs";
import type { Payable, Receivable } from "@/types/api";

/** "1 customer", "3 customers". A count label, not a calculation. */
function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * The credit book: who owes you, and whom you owe.
 *
 * The page a shop owner opens every evening. Every figure on it is the
 * backend's - the totals from the credit book summary, each party's balance,
 * age and overdue from its row, and every bill's paid and pending from the
 * receivable or payable behind it. Nothing is added up in the browser.
 */

type Side = "customers" | "suppliers";

const WORDS = {
  customers: {
    tab: "Customers owe you",
    owed: "Owes you",
    paid: "Received",
    due: "Pending",
    billWord: "Invoice",
    empty: "Nobody owes you money",
    emptyHint: "When you sell on credit, the customer shows up here until they pay.",
  },
  suppliers: {
    tab: "You owe suppliers",
    owed: "You owe",
    paid: "Paid",
    due: "To pay",
    billWord: "Bill",
    empty: "You owe no supplier",
    emptyHint: "When you buy on credit, the supplier shows up here until you pay.",
  },
} as const;

export function CreditPage() {
  const [side, setSide] = React.useState<Side>("customers");
  const [overdueOnly, setOverdueOnly] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [selected, setSelected] = React.useState<{ side: Side; row: CreditPartyRow } | null>(null);

  const customers = useQuery({
    queryKey: ["credit", "customers"],
    queryFn: () => creditBookApi.customers(),
  });
  const suppliers = useQuery({
    queryKey: ["credit", "suppliers"],
    queryFn: () => creditBookApi.suppliers(),
  });
  const collections = useQuery({
    queryKey: ["credit", "collections"],
    queryFn: () => creditApi.collections({ dueWithinDays: 7 }),
  });
  const dueSoon = (collections.data?.dueSoon ?? null) as { total?: string; invoiceCount?: number } | null;

  const active = side === "customers" ? customers : suppliers;
  const allRows = (side === "customers" ? customers.data?.customers : suppliers.data?.suppliers) ?? [];
  // Filtering an already-loaded list by name and flag is display, not maths.
  const rows = allRows.filter(
    (row) =>
      (!overdueOnly || row.isOverdue) &&
      (!search.trim() || (row.name ?? "").toLowerCase().includes(search.trim().toLowerCase())),
  );
  const words = WORDS[side];

  const columns: Column<CreditPartyRow>[] = [
    {
      header: side === "customers" ? "Customer" : "Supplier",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.name}</p>
          {row.phone ? <p className="text-xs text-muted-foreground">{row.phone}</p> : null}
        </div>
      ),
    },
    { header: words.owed, numeric: true, cell: (row) => <Money value={row.outstanding} className="font-semibold" /> },
    {
      header: "Overdue",
      numeric: true,
      cell: (row) =>
        row.isOverdue ? (
          <span className="inline-flex flex-col items-end gap-0.5">
            <Money value={row.overdue} className="text-destructive" />
            <span className="text-[11px] text-muted-foreground">
              {row.overdueCount} {words.billWord.toLowerCase()}
              {row.overdueCount === 1 ? "" : "s"}
            </span>
          </span>
        ) : (
          <Badge variant="outline">On time</Badge>
        ),
    },
    {
      header: "Oldest",
      hideOnMobile: true,
      cell: (row) =>
        row.ageInDays == null ? (
          "—"
        ) : (
          <span className="whitespace-nowrap">
            {row.ageInDays} days
            <span className="block text-xs text-muted-foreground">{formatDate(row.oldestDocumentDate)}</span>
          </span>
        ),
    },
    {
      header: "Last payment",
      hideOnMobile: true,
      cell: (row) =>
        row.lastPayment ? (
          <span className="whitespace-nowrap">
            {formatDate(row.lastPayment.date)}
            <span className="block text-xs text-muted-foreground">
              <Money value={row.lastPayment.amount} />
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">None yet</span>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <PageHeader title="Credit Book" description="Who owes you money, and whom you owe." />
        <ModuleTabs
          tabs={[
            { label: "Customers", href: ROUTES.customers },
            { label: "Credit Book", href: ROUTES.creditBook },
            { label: "Suppliers", href: ROUTES.suppliers },
          ]}
        />
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        <StatCard
          label="Customers owe you"
          value={<Money value={customers.data?.summary.total} />}
          hint={customers.data ? plural(customers.data.summary.partyCount, "customer") : undefined}
          icon={ArrowDownLeft}
          tone="credit"
          isLoading={customers.isLoading}
        />
        <StatCard
          label="You owe suppliers"
          value={<Money value={suppliers.data?.summary.total} />}
          hint={suppliers.data ? plural(suppliers.data.summary.partyCount, "supplier") : undefined}
          icon={ArrowUpRight}
          tone="dues"
          isLoading={suppliers.isLoading}
        />
        <StatCard
          label="Overdue from customers"
          value={<Money value={customers.data?.summary.overdue} />}
          hint={customers.data ? `${plural(customers.data.summary.overduePartyCount, "customer")} late` : undefined}
          icon={TriangleAlert}
          tone="dues"
          isLoading={customers.isLoading}
        />
        <StatCard
          label="Due in next 7 days"
          value={<Money value={dueSoon?.total} />}
          hint={dueSoon?.invoiceCount != null ? plural(dueSoon.invoiceCount, "invoice") : undefined}
          icon={CalendarClock}
          isLoading={collections.isLoading}
        />
      </div>

      <Tabs value={side} onValueChange={(value) => setSide(value as Side)}>
        <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
          <TabsList>
            <TabsTrigger value="customers">{WORDS.customers.tab}</TabsTrigger>
            <TabsTrigger value="suppliers">{WORDS.suppliers.tab}</TabsTrigger>
          </TabsList>
        </div>

        {(["customers", "suppliers"] as Side[]).map((value) => (
          <TabsContent key={value} value={value} className="mt-4">
            <DataTable
              columns={columns}
              rows={active.data ? rows : undefined}
              rowKey={(row) => row.partyId}
              isLoading={active.isLoading}
              error={active.error}
              onRetry={() => active.refetch()}
              search={search}
              onSearchChange={setSearch}
              searchPlaceholder="Search by name…"
              filters={
                <label className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm sm:min-h-[40px]">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={overdueOnly}
                    onChange={(event) => setOverdueOnly(event.target.checked)}
                  />
                  <AlarmClock className="h-4 w-4 text-muted-foreground" aria-hidden />
                  Overdue only
                </label>
              }
              onRowClick={(row) => setSelected({ side, row })}
              mobileCard={(row) => (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{row.name}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {row.lastPayment ? `Last paid ${formatDate(row.lastPayment.date)}` : "No payment yet"}
                      {row.ageInDays != null ? ` · ${row.ageInDays} days old` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Money value={row.outstanding} className="text-sm font-semibold" />
                    {row.isOverdue ? (
                      <Badge variant="destructive">Overdue</Badge>
                    ) : (
                      <Badge variant="outline">On time</Badge>
                    )}
                  </div>
                </div>
              )}
              emptyTitle={overdueOnly ? "Nothing overdue" : words.empty}
              emptyDescription={overdueOnly ? "Everyone is within their payment days." : words.emptyHint}
            />
          </TabsContent>
        ))}
      </Tabs>

      {/* The backend's note is written for an accountant; say it plainly here. */}
      {active.data ? (
        <p className="text-xs text-muted-foreground">
          These amounts update by themselves whenever a bill, a return or a payment is completed.
        </p>
      ) : null}

      <PartySheet selected={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

// --- one party's open bills ------------------------------------------------------

type OpenBill = Receivable & Payable & { creditAmount?: string };

function PartySheet({
  selected,
  onClose,
}: {
  selected: { side: Side; row: CreditPartyRow } | null;
  onClose: () => void;
}) {
  const side = selected?.side ?? "customers";
  const row = selected?.row;
  const words = WORDS[side];
  const isCustomer = side === "customers";

  const bills = useQuery({
    queryKey: ["credit", side, "open-bills", row?.partyId],
    queryFn: () =>
      isCustomer
        ? dueListsApi.receivables<OpenBill>({ customerId: row!.partyId, onlyOutstanding: true, limit: 100 })
        : dueListsApi.payables<OpenBill>({ supplierId: row!.partyId, onlyOutstanding: true, limit: 100 }),
    enabled: Boolean(row),
  });

  const billNumber = (bill: OpenBill) =>
    isCustomer ? bill.salesInvoice?.invoiceNumber : bill.purchase?.purchaseNumber;
  const billHref = (bill: OpenBill) =>
    isCustomer
      ? bill.salesInvoice && DETAIL_ROUTES.sale(bill.salesInvoice.id)
      : bill.purchase && DETAIL_ROUTES.purchase(bill.purchase.id);

  const partyHref = row
    ? isCustomer
      ? DETAIL_ROUTES.customer(row.partyId)
      : DETAIL_ROUTES.supplier(row.partyId)
    : "#";
  const payHref = row
    ? isCustomer
      ? `${ROUTES.moneyReceived}?customerId=${row.partyId}`
      : `${ROUTES.moneyPaid}?supplierId=${row.partyId}`
    : "#";

  return (
    <Sheet open={Boolean(selected)} onOpenChange={(open) => (open ? null : onClose())}>
      <SheetContent side="right" className="w-full max-w-md overflow-y-auto">
        {row ? (
          <div className="space-y-5 pt-2">
            <div className="pr-8">
              <SheetTitle className="text-lg">{row.name}</SheetTitle>
              <SheetDescription>
                {words.owed}: <Money value={row.outstanding} className="font-semibold text-foreground" />
              </SheetDescription>
            </div>

            <PaidDue total={row.billed} paid={row.paid} due={row.outstanding} />
            {Number(row.credited) !== 0 ? (
              <p className="text-xs text-muted-foreground">
                Returns: <Money value={row.credited} />
              </p>
            ) : null}

            <div className="grid grid-cols-1 gap-2">
              <Can do={isCustomer ? "money.receive" : "money.pay"}>
                <Button asChild className="min-h-[44px] gap-1.5">
                  <Link href={payHref}>
                    {isCustomer ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                    {isCustomer ? "Record payment" : "Pay supplier"}
                  </Link>
                </Button>
              </Can>
              <div className="grid grid-cols-2 gap-2">
                <Button asChild variant="outline" className="min-h-[44px] gap-1.5">
                  <Link href={`${partyHref}?tab=statement`}>
                    <BookOpen className="h-4 w-4" />
                    Statement
                  </Link>
                </Button>
                <Button asChild variant="outline" className="min-h-[44px] gap-1.5">
                  <Link href={partyHref}>
                    <UserRound className="h-4 w-4" />
                    Open {isCustomer ? "customer" : "supplier"}
                  </Link>
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold">
                {isCustomer ? "Unpaid invoices" : "Unpaid bills"}
              </h3>
              {bills.isLoading ? (
                <LoadingState rows={3} />
              ) : bills.error ? (
                <ErrorState error={bills.error} onRetry={() => bills.refetch()} />
              ) : !bills.data?.items.length ? (
                <EmptyState title="Nothing open" description="Every bill is settled." />
              ) : (
                <ul className="space-y-2">
                  {bills.data.items.map((bill) => {
                    const href = billHref(bill);
                    return (
                      <li key={bill.id} className="space-y-2 rounded-lg border p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {billNumber(bill) ?? "Opening balance"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Due {bill.dueDate ? formatDate(bill.dueDate) : "—"}
                            </p>
                          </div>
                          <OverdueBadge dueDate={bill.dueDate} />
                        </div>
                        <PaidDue total={bill.originalAmount} paid={bill.paidAmount} due={bill.outstandingAmount} />
                        {href ? (
                          <Link
                            href={href}
                            className="inline-flex min-h-[32px] items-center gap-1 text-xs font-medium text-primary hover:underline"
                          >
                            View {words.billWord.toLowerCase()}
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
              {bills.data && bills.data.pagination?.total > bills.data.items.length ? (
                <p className="text-xs text-muted-foreground">
                  Showing the first {bills.data.items.length}. See all on the {isCustomer ? "customer" : "supplier"} page.
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
