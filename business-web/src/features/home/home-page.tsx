"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownLeft,
  ArrowUpRight,
  BookOpen,
  Boxes,
  CalendarClock,
  PackageX,
  Receipt,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
  Truck,
  Wallet,
  Banknote,
} from "lucide-react";
import { dashboardApi, stockApi } from "@/lib/api";
import { useAuth } from "@/lib/auth/auth-context";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { ErrorState } from "@/components/shared/states";
import { ROUTES } from "@/lib/constants";
import { formatDate } from "@/lib/utils";
import { QuickActions } from "./quick-actions";
import { RecentActivity } from "./recent-activity";

/**
 * Home: the shop at a glance.
 *
 * EVERY MONEY FIGURE ON THIS PAGE COMES FROM GET /dashboard. Nothing is added up
 * in React: sales, dues, stock value and profit are produced by the backend
 * from posted documents and journal entries. Re-deriving any of them here
 * would create a second set of books that could disagree with the real one.
 *
 * The one count done here is "out of stock": the number of stock rows the
 * valuation report returns at zero or below. Counting rows is not accounting,
 * and the label says exactly what is being counted.
 */

function greetingFor(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {aside ? <span className="text-xs text-muted-foreground">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

export function HomePage() {
  const { user, company, isGstEnabled, can } = useAuth();

  // The greeting depends on the viewer's clock, so it is worked out after the
  // page mounts; rendering it on the server could greet in the wrong time zone.
  const [greeting, setGreeting] = React.useState("Hello");
  React.useEffect(() => setGreeting(greetingFor(new Date().getHours())), []);

  const dashboard = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => dashboardApi.get(),
  });

  const valuation = useQuery({
    queryKey: ["dashboard", "stock-valuation"],
    queryFn: () => stockApi.valuation(),
    enabled: can("inventory.read"),
  });

  const data = dashboard.data;
  const currency = data?.currency ?? "INR";
  const today = data?.today;
  const month = data?.thisMonth;
  const balances = data?.balances;
  const profit = data?.profit;
  const loading = dashboard.isLoading;

  const firstName = user?.name?.trim().split(/\s+/)[0];
  const outOfStock = valuation.data
    ? valuation.data.items.filter((item) => Number(item.quantity) <= 0).length
    : undefined;

  const money = (value: string | undefined | null, tone: "none" | "auto" = "none") => (
    <Money value={value} currency={currency} tone={tone} />
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={firstName ? `${greeting}, ${firstName}` : greeting}
        description={`${company?.name ?? "Your business"} · ${formatDate(data?.asOf ?? new Date())}`}
        actions={
          isGstEnabled ? (
            <Badge variant="success">GST on</Badge>
          ) : (
            <Badge variant="outline">GST off</Badge>
          )
        }
      />

      <QuickActions />

      {dashboard.error ? (
        <ErrorState error={dashboard.error} onRetry={() => dashboard.refetch()} />
      ) : (
        <>
          <Section title="Today">
            <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
              <StatCard
                label="Today's Sales"
                value={money(today?.sales?.total)}
                hint={
                  today?.sales?.invoiceCount !== undefined
                    ? `${today.sales.invoiceCount} bill(s)`
                    : undefined
                }
                icon={Receipt}
                isLoading={loading}
                href={ROUTES.sales}
              />
              <StatCard
                label="Today's Purchases"
                value={money(today?.purchases?.total)}
                hint={
                  today?.purchases?.billCount !== undefined
                    ? `${today.purchases.billCount} bill(s)`
                    : undefined
                }
                icon={ShoppingCart}
                isLoading={loading}
                href={ROUTES.purchases}
              />
              <StatCard
                label="Money Received"
                value={money(today?.moneyReceived?.total)}
                hint="Today"
                icon={ArrowDownLeft}
                tone="cash"
                isLoading={loading}
                href={ROUTES.moneyReceived}
              />
              <StatCard
                label="Money Paid"
                value={money(today?.moneyPaid?.total)}
                hint="Today"
                icon={ArrowUpRight}
                tone="dues"
                isLoading={loading}
                href={ROUTES.moneyPaid}
              />
              <StatCard
                label="Expenses"
                value={money(today?.expenses?.total)}
                hint={
                  today?.expenses?.expenseCount !== undefined
                    ? `${today.expenses.expenseCount} entry(s) today`
                    : undefined
                }
                icon={Wallet}
                isLoading={loading}
                href={ROUTES.expenses}
              />
              <StatCard
                label="Customer Credit"
                value={money(balances?.customerReceivables.total)}
                hint="Customers owe you"
                icon={BookOpen}
                tone="credit"
                isLoading={loading}
                href={ROUTES.creditBook}
              />
              <StatCard
                label="Supplier Due"
                value={money(balances?.supplierPayables.total)}
                hint="You owe suppliers"
                icon={Truck}
                tone="dues"
                isLoading={loading}
                href={ROUTES.supplierPayables}
              />
            </div>
          </Section>

          <Section title="Stock">
            <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
              <StatCard
                label="Total Stock Value"
                value={money(balances?.inventory.totalValue)}
                hint={
                  balances?.inventory ? `${balances.inventory.itemCount} item(s)` : undefined
                }
                icon={Boxes}
                isLoading={loading}
                href={ROUTES.stock}
              />
              <StatCard
                label="Low Stock"
                value={balances?.inventory.lowStockCount ?? "—"}
                hint="At or below reorder level"
                icon={TrendingDown}
                tone="credit"
                isLoading={loading}
                href={ROUTES.lowStock}
              />
              <StatCard
                label="Out of Stock"
                value={
                  valuation.error ? "—" : outOfStock !== undefined ? outOfStock : "—"
                }
                hint={
                  valuation.error
                    ? "Could not load"
                    : "Stock lines at zero or below"
                }
                icon={PackageX}
                tone="dues"
                isLoading={valuation.isLoading && valuation.fetchStatus !== "idle"}
                href={ROUTES.stock}
              />
              {/* Expiry dates are not stored anywhere yet, so there is no number
                  to show. A muted card says so instead of a plausible zero. */}
              <Card className="h-full border-dashed bg-muted/30 shadow-none">
                <CardContent className="flex items-start gap-2.5 p-3 sm:gap-3 sm:p-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground sm:h-10 sm:w-10">
                    <CalendarClock className="h-4 w-4 sm:h-5 sm:w-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium leading-tight text-muted-foreground sm:text-xs">
                      Expiring Soon
                    </p>
                    <p className="mt-0.5 text-sm font-medium text-muted-foreground">
                      Not tracked yet
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground sm:text-xs">
                      Expiry dates are not recorded
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </Section>

          <Section title="This month" aside="From your books">
            <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-5">
              <StatCard
                label="Total Sales"
                value={money(month?.sales?.total)}
                hint={
                  month?.sales?.invoiceCount !== undefined
                    ? `${month.sales.invoiceCount} bill(s)`
                    : undefined
                }
                icon={TrendingUp}
                isLoading={loading}
                href={ROUTES.salesReport}
              />
              <StatCard
                label="Total Purchase"
                value={money(month?.purchases?.total)}
                hint={
                  month?.purchases?.billCount !== undefined
                    ? `${month.purchases.billCount} bill(s)`
                    : undefined
                }
                icon={ShoppingCart}
                isLoading={loading}
                href={ROUTES.purchaseReport}
              />
              <StatCard
                label="Gross Profit"
                value={money(profit?.grossProfit, "auto")}
                hint="Sales minus cost of goods sold"
                icon={Banknote}
                tone="cash"
                isLoading={loading}
                href={ROUTES.profitLoss}
              />
              <StatCard
                label="Expenses"
                value={money(profit?.operatingExpenses ?? profit?.otherExpenses)}
                hint="Posted expenses"
                icon={Wallet}
                isLoading={loading}
                href={ROUTES.expenses}
              />
              <StatCard
                label="Net Profit"
                value={money(profit?.netProfit, "auto")}
                hint="Gross profit minus expenses"
                icon={TrendingUp}
                tone="cash"
                isLoading={loading}
                href={ROUTES.profitLoss}
              />
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Profit counts only bills and expenses that are posted this month. Drafts are not
              included, and any cost you have not recorded as an expense cannot appear here.
            </p>
          </Section>

          <RecentActivity />
        </>
      )}
    </div>
  );
}
