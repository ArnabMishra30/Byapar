"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  PackageMinus,
  PackagePlus,
  Receipt,
  ShoppingCart,
  Wallet,
} from "lucide-react";
import {
  expensesApi,
  inventoryApi,
  moneyInApi,
  moneyOutApi,
  purchasesApi,
  salesApi,
} from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState, LoadingState } from "@/components/shared/states";
import { DETAIL_ROUTES, ROUTES } from "@/lib/constants";
import { cn, formatDate } from "@/lib/utils";

/**
 * What happened lately, across the whole shop.
 *
 * There is no "activity" endpoint on the backend, so this reads the newest few
 * rows from each list the shop already has and shows them together. Every
 * figure is the document's own amount as the API sent it; the only thing done
 * here is ordering the rows by date so the newest is on top.
 *
 * Each source is fetched independently (Promise.allSettled): if, say, stock
 * movements fail to load, sales and payments still show, and the screen says
 * which part is missing instead of blanking the whole feed.
 */

type Kind = "sale" | "purchase" | "moneyIn" | "moneyOut" | "expense" | "stockIn" | "stockOut";

interface ActivityItem {
  key: string;
  kind: Kind;
  title: string;
  party?: string;
  amount?: string;
  status?: string;
  href: string;
  /** Business date first, then creation time - used only for ordering. */
  sortKey: string;
  date?: string;
}

const KIND: Record<Kind, { label: string; icon: React.ElementType; tone: string }> = {
  sale: { label: "Sale", icon: Receipt, tone: "bg-primary/10 text-primary" },
  purchase: { label: "Purchase", icon: ShoppingCart, tone: "bg-primary/10 text-primary" },
  moneyIn: { label: "Money received", icon: ArrowDownLeft, tone: "bg-success/10 text-success" },
  moneyOut: { label: "Money paid", icon: ArrowUpRight, tone: "bg-destructive/10 text-destructive" },
  expense: { label: "Expense", icon: Wallet, tone: "bg-warning/10 text-warning" },
  stockIn: { label: "Stock added", icon: PackagePlus, tone: "bg-success/10 text-success" },
  stockOut: { label: "Stock removed", icon: PackageMinus, tone: "bg-warning/10 text-warning" },
};

const PER_SOURCE = 5;
const SHOWN = 10;

const str = (value: unknown) => (typeof value === "string" ? value : "");

async function loadActivity() {
  const sources: { name: string; load: () => Promise<ActivityItem[]> }[] = [
    {
      name: "Sales",
      load: async () =>
        (await salesApi.list({ limit: PER_SOURCE })).items.map((doc) => ({
          key: `sale-${doc.id}`,
          kind: "sale" as const,
          title: doc.invoiceNumber || "Draft sale",
          party: doc.customer?.name,
          amount: doc.grandTotal,
          status: doc.status,
          href: DETAIL_ROUTES.sale(doc.id),
          sortKey: `${str(doc.invoiceDate).slice(0, 10)}|${str(doc.createdAt)}`,
          date: doc.invoiceDate,
        })),
    },
    {
      name: "Purchases",
      load: async () =>
        (await purchasesApi.list({ limit: PER_SOURCE })).items.map((doc) => ({
          key: `purchase-${doc.id}`,
          kind: "purchase" as const,
          title: doc.purchaseNumber || doc.invoiceNumber || "Draft purchase",
          party: doc.supplier?.name,
          amount: doc.grandTotal,
          status: doc.status,
          href: DETAIL_ROUTES.purchase(doc.id),
          sortKey: `${str(doc.invoiceDate).slice(0, 10)}|${str(doc.createdAt)}`,
          date: doc.invoiceDate,
        })),
    },
    {
      name: "Money received",
      load: async () =>
        (await moneyInApi.list({ limit: PER_SOURCE })).items.map((doc) => ({
          key: `in-${doc.id}`,
          kind: "moneyIn" as const,
          title: doc.paymentNumber || "Receipt",
          party: doc.customer?.name,
          amount: doc.amount,
          status: doc.status,
          href: `${ROUTES.moneyReceived}?customerId=${doc.customer?.id ?? ""}`,
          sortKey: `${str(doc.paymentDate).slice(0, 10)}|${str(doc.createdAt)}`,
          date: doc.paymentDate,
        })),
    },
    {
      name: "Money paid",
      load: async () =>
        (await moneyOutApi.list({ limit: PER_SOURCE })).items.map((doc) => ({
          key: `out-${doc.id}`,
          kind: "moneyOut" as const,
          // SupplierPayment's type is an Omit<> over an indexed type, which
          // widens these fields to unknown; str() narrows them back safely.
          title: str(doc.paymentNumber) || "Payment",
          party: doc.supplier?.name,
          amount: str(doc.amount) || undefined,
          status: str(doc.status) || undefined,
          href: `${ROUTES.moneyPaid}?supplierId=${doc.supplier?.id ?? ""}`,
          sortKey: `${str(doc.paymentDate).slice(0, 10)}|${str(doc.createdAt)}`,
          date: str(doc.paymentDate) || undefined,
        })),
    },
    {
      name: "Expenses",
      load: async () =>
        (await expensesApi.list({ limit: PER_SOURCE })).items.map((doc) => ({
          key: `expense-${doc.id}`,
          kind: "expense" as const,
          title: doc.expenseNumber || "Expense",
          party: doc.category?.name ?? doc.description ?? undefined,
          amount: doc.amount,
          status: doc.status,
          href: ROUTES.expenses,
          sortKey: `${str(doc.expenseDate).slice(0, 10)}|${str(doc.createdAt)}`,
          date: doc.expenseDate,
        })),
    },
    ...(["ADJUSTMENT_IN", "ADJUSTMENT_OUT"] as const).map((type) => ({
      name: type === "ADJUSTMENT_IN" ? "Stock added" : "Stock removed",
      load: async () =>
        (await inventoryApi.movements({ type, limit: PER_SOURCE })).items.map((move) => ({
          key: `move-${move.id}`,
          kind: type === "ADJUSTMENT_IN" ? ("stockIn" as const) : ("stockOut" as const),
          title: `${move.quantity} × ${move.product?.name ?? "item"}`,
          party: move.warehouse?.name,
          amount: move.totalCost,
          href: move.product?.id
            ? `${ROUTES.stockAdjustments}?productId=${move.product.id}`
            : ROUTES.stockAdjustments,
          sortKey: `${str(move.createdAt).slice(0, 10)}|${str(move.createdAt)}`,
          date: move.createdAt,
        })),
    })),
  ];

  const results = await Promise.allSettled(sources.map((source) => source.load()));

  const items: ActivityItem[] = [];
  const failed: string[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") items.push(...result.value);
    else failed.push(sources[index].name);
  });

  // Ordering only - newest first. No figures are touched.
  items.sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0));
  return { items, failed };
}

export function RecentActivity() {
  const [showAll, setShowAll] = React.useState(false);
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["dashboard", "recent-activity"],
    queryFn: loadActivity,
  });

  const items = data?.items ?? [];
  const visible = showAll ? items : items.slice(0, SHOWN);

  return (
    <section className="space-y-3" aria-labelledby="recent-activity-title">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="recent-activity-title" className="text-sm font-semibold text-foreground">
          Recent activity
        </h2>
        <span className="text-xs text-muted-foreground">Newest first</span>
      </div>

      {isLoading ? (
        <LoadingState rows={4} />
      ) : (
        <>
          {data && data.failed.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-muted-foreground">
              <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden />
              <span className="min-w-0 flex-1">
                Could not load: {data.failed.join(", ")}. Everything else below is up to date.
              </span>
              <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
                Try again
              </Button>
            </div>
          ) : null}

          {items.length === 0 ? (
            <EmptyState
              title="No activity yet"
              description="Your sales, purchases, payments and expenses will show up here as you record them."
            />
          ) : (
            <Card>
              <CardContent className="p-0">
                <ul className="divide-y">
                  {visible.map((item) => {
                    const meta = KIND[item.kind];
                    return (
                      <li key={item.key}>
                        <Link
                          href={item.href}
                          className="flex min-h-[3.5rem] items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none sm:px-4"
                        >
                          <span
                            className={cn(
                              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                              meta.tone,
                            )}
                          >
                            <meta.icon className="h-4 w-4" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{item.title}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {meta.label}
                              {item.party ? ` · ${item.party}` : ""}
                              {item.date ? ` · ${formatDate(item.date)}` : ""}
                            </span>
                          </span>
                          <span className="flex shrink-0 flex-col items-end gap-1">
                            {item.amount != null ? (
                              <Money value={item.amount} className="text-sm font-semibold" />
                            ) : null}
                            {item.status ? <StatusBadge status={item.status} /> : null}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          )}

          {items.length > SHOWN ? (
            <Button variant="ghost" size="sm" className="w-full" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show less" : `Show all ${items.length}`}
            </Button>
          ) : null}
        </>
      )}
    </section>
  );
}
