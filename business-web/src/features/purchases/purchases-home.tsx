"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarDays, HandCoins, Plus, ShoppingCart, Upload } from "lucide-react";
import { creditApi, dashboardApi } from "@/lib/api";
import type { CreditPartyRow } from "@/lib/api/extended";
import { DETAIL_ROUTES, ROUTES } from "@/lib/constants";
import { PageHeader } from "@/components/shared/page-header";
import { ModuleTabs } from "@/components/shared/module-tabs";
import { StatCard } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { ErrorState, LoadingState } from "@/components/shared/states";
import { NotAvailable } from "@/components/shared/not-available";
import { Can } from "@/components/shared/permission-gate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DraftsCard, PeriodRegisterCard } from "@/features/documents/home-parts";
import { isPositive } from "@/features/documents/doc-helpers";
import { PURCHASE_TABS } from "./tabs";

/**
 * The Purchase front page: what came in, what you owe, what is unfinished.
 *
 * Totals are the backend's: today / this month and supplier dues from the
 * dashboard, the period total from the purchase register, and the suppliers
 * list from the credit book. The register has no "total paid" figure for a
 * period, so none is shown.
 */
export function PurchasesHome() {
  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: () => dashboardApi.get() });
  const credit = useQuery({ queryKey: ["credit", "book"], queryFn: () => creditApi.book() });

  const d = dashboard.data;
  const payables = d?.balances?.supplierPayables;
  const topSuppliers =
    ((credit.data?.owedByMe as { topSuppliers?: CreditPartyRow[] } | undefined)?.topSuppliers ?? []).filter(
      (row) => isPositive(row.outstanding),
    );

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <PageHeader
          title="Purchases"
          description="Bills from suppliers, and what you still owe them."
          actions={
            <Can do="purchases.post">
              <Button asChild className="gap-1.5">
                <Link href={ROUTES.newPurchase}>
                  <Plus className="h-4 w-4" />
                  New Purchase
                </Link>
              </Button>
            </Can>
          }
        />
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" className="min-h-[44px] gap-1.5 sm:min-h-0">
            <Link href={`${ROUTES.bills}?upload=1&direction=IN`}>
              <Upload className="h-4 w-4" />
              Upload purchase bill
            </Link>
          </Button>
        </div>
        <ModuleTabs tabs={PURCHASE_TABS} />
      </div>

      {dashboard.error ? (
        <ErrorState error={dashboard.error} onRetry={() => dashboard.refetch()} />
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Today's purchase"
            icon={ShoppingCart}
            isLoading={dashboard.isLoading}
            value={<Money value={d?.today?.purchases?.total ?? null} />}
            hint={d?.today?.purchases?.billCount != null ? `${d.today.purchases.billCount} bills` : undefined}
          />
          <StatCard
            label="This month"
            icon={CalendarDays}
            isLoading={dashboard.isLoading}
            value={<Money value={d?.thisMonth?.purchases?.total ?? null} />}
            hint={
              d?.thisMonth?.purchases?.billCount != null ? `${d.thisMonth.purchases.billCount} bills` : undefined
            }
          />
          <StatCard
            label="You owe suppliers"
            icon={HandCoins}
            tone="dues"
            href={ROUTES.supplierPayables}
            isLoading={dashboard.isLoading}
            value={<Money value={payables?.total ?? null} />}
            hint={payables ? `${payables.billCount} unpaid bills` : undefined}
          />
          <StatCard
            label="Overdue to suppliers"
            icon={AlertTriangle}
            tone="credit"
            href={ROUTES.supplierPayables}
            isLoading={dashboard.isLoading}
            value={<Money value={payables?.overdue ?? null} />}
            hint={payables ? `${payables.overdueCount} bills past due date` : undefined}
          />
        </div>
      )}

      <PeriodRegisterCard kind="purchase" />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Suppliers you owe the most</CardTitle>
            <p className="text-xs text-muted-foreground">Ranked by the amount you still owe them.</p>
          </CardHeader>
          <CardContent>
            {credit.error ? (
              <ErrorState error={credit.error} onRetry={() => credit.refetch()} />
            ) : credit.isLoading ? (
              <LoadingState rows={3} />
            ) : topSuppliers.length === 0 ? (
              <p className="text-sm text-muted-foreground">You don&apos;t owe any supplier right now.</p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {topSuppliers.map((row) => (
                  <li key={row.partyId} className="flex items-center gap-3 p-3">
                    <Link href={DETAIL_ROUTES.supplier(row.partyId)} className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{row.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.isOverdue ? (
                          <span className="text-destructive">
                            <Money value={row.overdue} /> overdue
                          </span>
                        ) : (
                          `${row.billCount ?? 0} bills`
                        )}
                      </p>
                    </Link>
                    <Money value={row.outstanding} className="shrink-0 text-sm font-semibold" />
                    <Can do="money.pay">
                      <Button asChild size="sm" variant="outline" className="min-h-[44px] shrink-0 sm:min-h-0">
                        <Link href={`${ROUTES.moneyPaid}?supplierId=${encodeURIComponent(row.partyId)}`}>
                          Pay
                        </Link>
                      </Button>
                    </Can>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <DraftsCard kind="purchase" />
      </div>

      <NotAvailable
        features={[
          {
            title: "Purchase Orders",
            description: "Not in the system yet. Save a purchase as a draft until the goods arrive.",
          },
          {
            title: "Pending purchase orders",
            description: "Needs purchase orders first. Drafts above show bills not yet completed.",
          },
          {
            title: "Purchase Out",
            description:
              "Sending goods back to a supplier is a Purchase Return — use the Purchase Returns tab. There is no separate 'purchase out' document.",
          },
          {
            title: "Top purchased products",
            description: "No item-wise purchase report yet. Stock Reports show what you hold.",
          },
          {
            title: "Total paid for a period",
            description:
              "The purchase register gives a period total but not a paid total. Each bill still shows its own paid and due.",
          },
        ]}
      />
    </div>
  );
}
