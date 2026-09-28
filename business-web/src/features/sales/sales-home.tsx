"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Ban, CalendarDays, HandCoins, Plus, Receipt, Undo2, Zap } from "lucide-react";
import { dashboardApi, salesApi } from "@/lib/api";
import { ROUTES } from "@/lib/constants";
import { PageHeader } from "@/components/shared/page-header";
import { ModuleTabs } from "@/components/shared/module-tabs";
import { StatCard } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { ErrorState } from "@/components/shared/states";
import { NotAvailable } from "@/components/shared/not-available";
import { Can } from "@/components/shared/permission-gate";
import { Button } from "@/components/ui/button";
import { DraftsCard, PeriodRegisterCard } from "@/features/documents/home-parts";
import { SALES_TABS } from "./tabs";

/**
 * The Sales front page: how much was sold, who still owes, what is unfinished.
 *
 * Every figure is the backend's. Today / this month and "customers owe you"
 * come from the dashboard; the period total from the sales register; the
 * cancelled count is the size of the cancelled list, which is a count of rows,
 * not money.
 */
export function SalesHome() {
  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: () => dashboardApi.get() });
  const cancelled = useQuery({
    queryKey: ["sale", "list", "CANCELLED", "count"],
    queryFn: () => salesApi.list({ status: "CANCELLED", limit: 1 }),
  });

  const d = dashboard.data;
  const receivables = d?.balances?.customerReceivables;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <PageHeader
          title="Sales"
          description="What you sold, and what customers still owe you."
          actions={
            <Can do="sales.draft">
              <Button asChild className="gap-1.5">
                <Link href={ROUTES.newSale}>
                  <Plus className="h-4 w-4" />
                  New Sale
                </Link>
              </Button>
            </Can>
          }
        />
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" className="min-h-[44px] gap-1.5 sm:min-h-0">
            <Link href={ROUTES.quickBilling}>
              <Zap className="h-4 w-4" />
              Quick Billing
            </Link>
          </Button>
          <Button asChild variant="outline" className="min-h-[44px] gap-1.5 sm:min-h-0">
            <Link href={ROUTES.salesReturns}>
              <Undo2 className="h-4 w-4" />
              Returns
            </Link>
          </Button>
        </div>
        <ModuleTabs tabs={SALES_TABS} />
      </div>

      {dashboard.error ? (
        <ErrorState error={dashboard.error} onRetry={() => dashboard.refetch()} />
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Today's sales"
            icon={Receipt}
            isLoading={dashboard.isLoading}
            value={<Money value={d?.today?.sales?.total ?? null} />}
            hint={d?.today?.sales?.invoiceCount != null ? `${d.today.sales.invoiceCount} invoices` : undefined}
          />
          <StatCard
            label="This month"
            icon={CalendarDays}
            isLoading={dashboard.isLoading}
            value={<Money value={d?.thisMonth?.sales?.total ?? null} />}
            hint={
              d?.thisMonth?.sales?.invoiceCount != null ? `${d.thisMonth.sales.invoiceCount} invoices` : undefined
            }
          />
          <StatCard
            label="Customers owe you"
            icon={HandCoins}
            tone="credit"
            href={ROUTES.creditBook}
            isLoading={dashboard.isLoading}
            value={<Money value={receivables?.total ?? null} />}
            hint={
              receivables && Number(receivables.overdue) > 0 ? (
                <>
                  <Money value={receivables.overdue} /> overdue
                </>
              ) : receivables ? (
                `${receivables.invoiceCount} unpaid invoices`
              ) : undefined
            }
          />
          <StatCard
            label="Cancelled sales"
            icon={Ban}
            href={`${ROUTES.salesInvoices}?tab=cancelled`}
            isLoading={cancelled.isLoading}
            value={cancelled.error ? "—" : String(cancelled.data?.pagination?.total ?? 0)}
            hint="Drafts that were cancelled"
          />
        </div>
      )}

      <PeriodRegisterCard kind="sale" />

      <DraftsCard kind="sale" />

      <NotAvailable
        features={[
          {
            title: "Estimates / Quotations",
            description: "Not in the system yet. Save a sale as a draft and complete it when the customer agrees.",
          },
          {
            title: "Sales Orders",
            description: "Not in the system yet. A draft sale works as an order until you complete it.",
          },
          {
            title: "Delivery Challans",
            description: "Not in the system yet. Print the invoice and hand it over with the goods.",
          },
          {
            title: "Salesperson-wise sales",
            description: "Sales are not linked to a salesperson yet. Each invoice shows who created it.",
          },
          {
            title: "Product-wise sales",
            description: "No item-wise sales report yet. Use Stock and Sales Reports for now.",
          },
          {
            title: "Filter by paid / unpaid",
            description:
              "The server cannot filter invoices by payment status yet. Use the Credit Book to see every unpaid invoice.",
          },
        ]}
      />
    </div>
  );
}
