"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  BookOpen,
  Boxes,
  Landmark,
  Plus,
  Receipt,
  ScanLine,
  ShoppingCart,
  TrendingUp,
  Truck,
  UserCheck,
  Wallet,
} from "lucide-react";
import { dashboardApi } from "@/lib/api";
import { useAuth } from "@/lib/auth/auth-context";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { ScanBillCta } from "@/features/bills/scan-bill-cta";
import { ErrorState } from "@/components/shared/states";
import { Money } from "@/components/shared/money";
import { Can } from "@/components/shared/permission-gate";
import { formatDate, cn } from "@/lib/utils";
import type { Capability } from "@/lib/permissions";

/**
 * The business dashboard.
 *
 * EVERY NUMBER ON THIS PAGE COMES FROM GET /dashboard.
 *
 * Nothing is added up in React. Profit, customer credit, supplier dues, cash,
 * bank and stock value are all produced by the backend from posted journal
 * entries and the two sub-ledgers. Re-deriving any of them here would create a
 * second set of books that could disagree with the real one, and the shopkeeper
 * would have no way to tell which was right.
 *
 * Nothing is invented either. If the backend does not send a figure, the card
 * says so instead of showing a plausible zero.
 */

function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  href,
  isLoading,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon: React.ElementType;
  tone?: "default" | "credit" | "dues" | "cash";
  href?: string;
  isLoading?: boolean;
}) {
  const tones = {
    default: "bg-primary/10 text-primary",
    credit: "bg-warning/10 text-warning",
    dues: "bg-destructive/10 text-destructive",
    cash: "bg-success/10 text-success",
  } as const;

  const body = (
    <Card className={cn("h-full transition-colors", href && "hover:border-primary/40")}>
      <CardContent className="flex items-start gap-3 p-4">
        <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", tones[tone])}>
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          {isLoading ? (
            <Skeleton className="mt-1.5 h-6 w-24" />
          ) : (
            <p className="mt-0.5 truncate text-lg font-bold text-foreground sm:text-xl">{value}</p>
          )}
          {hint && !isLoading ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );

  return href ? (
    <Link href={href} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl">
      {body}
    </Link>
  ) : (
    body
  );
}

/**
 * The things a shopkeeper does twenty times a day.
 *
 * Each one is gated on what the role can ACTUALLY do, read from the backend
 * route table: a staff member can draft a sale, a purchase or an expense, but
 * only an admin can record money in or out, or add a customer or supplier.
 * Showing a staff member a "Receive money" button would only walk them into a
 * 403 they cannot resolve.
 */
const QUICK_ACTIONS: {
  label: string;
  href: string;
  icon: React.ElementType;
  capability: Capability;
}[] = [
  // A staff member may prepare a bill; only an admin can confirm one, which is
  // the same split every other document follows.
  { label: "Scan a bill", href: "/shop/bills", icon: ScanLine, capability: "purchases.draft" },
  { label: "New sale", href: "/shop/sales", icon: Receipt, capability: "sales.draft" },
  { label: "New purchase", href: "/shop/purchases", icon: ShoppingCart, capability: "purchases.draft" },
  { label: "Add expense", href: "/shop/expenses", icon: Wallet, capability: "expenses.draft" },
  { label: "Money received", href: "/shop/money-in", icon: ArrowDownLeft, capability: "money.receive" },
  { label: "Pay supplier", href: "/shop/money-out", icon: ArrowUpRight, capability: "money.pay" },
  { label: "Add customer", href: "/shop/customers", icon: UserCheck, capability: "parties.manage" },
  { label: "Add supplier", href: "/shop/suppliers", icon: Truck, capability: "parties.manage" },
];

export default function DashboardPage() {
  const { user, company, isGstEnabled } = useAuth();

  const {
    data: dashboard,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => dashboardApi.get(),
  });

  const currency = dashboard?.currency ?? "INR";
  const today = dashboard?.today;
  const balances = dashboard?.balances;
  const profit = dashboard?.profit;

  const firstName = user?.name?.split(" ")[0];

  return (
    <div className="space-y-6">
      <PageHeader
        title={firstName ? `Hello, ${firstName}` : "Dashboard"}
        description={
          dashboard
            ? `${company?.name ?? "Your business"} · ${formatDate(dashboard.asOf)}`
            : company?.name ?? undefined
        }
        actions={
          isGstEnabled ? (
            <Badge variant="secondary">GST registered</Badge>
          ) : (
            <Badge variant="outline">No GST</Badge>
          )
        }
      />

      {/* The fastest way to record a bill, given the top of the screen. */}
      <ScanBillCta />

      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <>
          {/* Today */}
          <section className="space-y-2.5 sm:space-y-3">
            <h2 className="text-sm font-semibold text-foreground">Today</h2>
            <div className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
              <StatCard
                label="Sales today"
                value={<Money value={today?.sales?.total} currency={currency} />}
                hint={
                  today?.sales?.invoiceCount !== undefined
                    ? `${today.sales.invoiceCount} bill(s)`
                    : undefined
                }
                icon={Receipt}
                isLoading={isLoading}
                href="/shop/sales"
              />
              <StatCard
                label="Expenses today"
                value={<Money value={today?.expenses?.total} currency={currency} />}
                hint={
                  today?.expenses?.expenseCount !== undefined
                    ? `${today.expenses.expenseCount} entry(s)`
                    : undefined
                }
                icon={Wallet}
                isLoading={isLoading}
                href="/shop/expenses"
              />
              <StatCard
                label="Money received today"
                value={<Money value={dashboard?.collections?.received.total} currency={currency} />}
                hint={
                  dashboard?.collections?.received.receiptCount !== undefined
                    ? `${dashboard.collections.received.receiptCount} receipt(s)`
                    : undefined
                }
                icon={ArrowDownLeft}
                tone="cash"
                isLoading={isLoading}
              />
              <StatCard
                label="Money paid today"
                value={<Money value={dashboard?.collections?.paid.total} currency={currency} />}
                hint={
                  dashboard?.collections?.paid.paymentCount !== undefined
                    ? `${dashboard.collections.paid.paymentCount} payment(s)`
                    : undefined
                }
                icon={ArrowUpRight}
                tone="dues"
                isLoading={isLoading}
              />
            </div>
          </section>

          {/* What the business is owed, owes and holds */}
          <section className="space-y-2.5 sm:space-y-3">
            <h2 className="text-sm font-semibold text-foreground">Right now</h2>
            <div className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
              <StatCard
                label="Customer credit (udhaar)"
                value={<Money value={balances?.customerReceivables.total} currency={currency} />}
                hint={
                  balances?.customerReceivables
                    ? `${balances.customerReceivables.invoiceCount} bill(s) · overdue ${balances.customerReceivables.overdue}`
                    : undefined
                }
                icon={BookOpen}
                tone="credit"
                isLoading={isLoading}
                href="/shop/credit"
              />
              <StatCard
                label="Supplier dues"
                value={<Money value={balances?.supplierPayables.total} currency={currency} />}
                hint={
                  balances?.supplierPayables
                    ? `${balances.supplierPayables.billCount} bill(s) · overdue ${balances.supplierPayables.overdue}`
                    : undefined
                }
                icon={Truck}
                tone="dues"
                isLoading={isLoading}
                href="/shop/credit"
              />
              <StatCard
                label="Cash & bank"
                value={<Money value={balances?.cashAndBank.totalBalance} currency={currency} tone="auto" />}
                hint="From the books"
                icon={Landmark}
                tone="cash"
                isLoading={isLoading}
                href="/shop/cash-bank"
              />
              <StatCard
                label="Stock value"
                value={<Money value={balances?.inventory.totalValue} currency={currency} />}
                hint={
                  balances?.inventory
                    ? `${balances.inventory.itemCount} item(s)${
                        balances.inventory.lowStockCount
                          ? ` · ${balances.inventory.lowStockCount} low`
                          : ""
                      }`
                    : undefined
                }
                icon={Boxes}
                isLoading={isLoading}
                href="/shop/inventory"
              />
            </div>
          </section>

          {/* This month, from the general ledger */}
          <section className="space-y-2.5 sm:space-y-3">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-foreground">This month</h2>
              <span className="text-xs text-muted-foreground">From your books</span>
            </div>

            <Card>
              <CardContent className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-4 sm:gap-4 sm:p-4">
                {[
                  { label: "Sales", value: profit?.revenue, icon: TrendingUp },
                  { label: "Cost of goods sold", value: profit?.costOfGoodsSold, icon: ShoppingCart },
                  { label: "Expenses", value: profit?.operatingExpenses ?? profit?.otherExpenses, icon: Wallet },
                  { label: "Profit", value: profit?.netProfit, icon: Banknote },
                ].map((row) => (
                  <div key={row.label} className="min-w-0">
                    <p className="truncate text-xs text-muted-foreground">{row.label}</p>
                    {isLoading ? (
                      <Skeleton className="mt-1.5 h-6 w-20" />
                    ) : (
                      <p className="mt-0.5 truncate text-base font-bold sm:text-lg">
                        <Money
                          value={row.value}
                          currency={currency}
                          tone={row.label === "Profit" ? "auto" : "none"}
                        />
                      </p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>

            {profit?.basis ? (
              <p className="text-xs text-muted-foreground">{profit.basis}</p>
            ) : null}
          </section>

          {/* Quick actions */}
          <section className="space-y-2.5 sm:space-y-3">
            <h2 className="text-sm font-semibold text-foreground">Quick actions</h2>
            <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-3 sm:overflow-visible sm:px-0 lg:grid-cols-4 xl:grid-cols-7 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {QUICK_ACTIONS.map((action) => (
                <Can key={action.label} do={action.capability}>
                  <Button
                    asChild
                    variant="outline"
                    className="h-auto w-[5.5rem] shrink-0 flex-col gap-2 py-3 sm:w-full sm:py-4"
                  >
                    <Link href={action.href}>
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <action.icon className="h-4 w-4" aria-hidden />
                      </span>
                      <span className="text-center text-xs font-medium leading-tight">
                        {action.label}
                      </span>
                    </Link>
                  </Button>
                </Can>
              ))}
            </div>

            <Can
              do="money.receive"
              fallback={
                <p className="text-xs text-muted-foreground">
                  Recording money in and out, and adding customers or suppliers, is done by an
                  admin. You can prepare sales, purchases and expenses.
                </p>
              }
            >
              <span className="sr-only">All quick actions are available to you.</span>
            </Can>
          </section>

          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Plus className="h-3 w-3" aria-hidden />
            More screens are being added. Every figure above comes from your books.
          </p>
        </>
      )}
    </div>
  );
}
