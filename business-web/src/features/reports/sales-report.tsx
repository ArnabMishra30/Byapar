"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { HandCoins, Receipt, TrendingUp, Undo2 } from "lucide-react";
import { registersApi, type SalesRegisterRow } from "@/lib/api";
import { useAuth } from "@/lib/auth/auth-context";
import { DETAIL_ROUTES, ROUTES } from "@/lib/constants";
import { formatDate } from "@/lib/utils";
import { DataTable, useListState, type Column } from "@/components/shared/data-table";
import { StatCard } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { PaidDue } from "@/components/shared/paid-due";
import { StatusBadge } from "@/components/shared/status-badge";
import { NotAvailable } from "@/components/shared/not-available";
import { Button } from "@/components/ui/button";
import { ReportNote, ReportSection, ReportShell, StatGrid, rangeParams, useReportRange } from "./report-shell";
import { MethodBreakdown, PartyFilter, SmallFigure } from "./report-parts";
import { reportCalls } from "./api";

/**
 * Sales report: what was sold in the period, what has been collected, and what
 * each customer still owes on each bill.
 *
 * POSTED sales only - a draft has not happened yet. Every total is the
 * backend's figure for the WHOLE period, not a sum of the page on screen.
 */
export function SalesReport() {
  const router = useRouter();
  const { isGstEnabled } = useAuth();
  const [range, setRange] = useReportRange();
  const [customer, setCustomer] = React.useState<{ id: string; name: string } | null>(null);
  const list = useListState({ limit: 20 });
  const { setPage } = list;

  // A new period or customer is a new list: back to page 1.
  const params = { ...rangeParams(range), customerId: customer?.id };
  const paramsKey = JSON.stringify(params);
  React.useEffect(() => setPage(1), [paramsKey, setPage]);

  const register = useQuery({
    queryKey: ["report", "sales", params, list.page],
    queryFn: () => registersApi.sales({ ...params, page: list.page, limit: list.limit }),
    placeholderData: keepPreviousData,
  });

  const received = useQuery({
    queryKey: ["report", "payments-received", params],
    queryFn: () => reportCalls.paymentsReceived({ ...params, limit: 1 }),
  });

  const totals = register.data?.totals;

  const columns: Column<SalesRegisterRow>[] = [
    {
      header: "Bill no.",
      cell: (row) => <span className="font-medium">{row.invoiceNumber}</span>,
    },
    { header: "Date", cell: (row) => formatDate(row.invoiceDate) },
    { header: "Customer", cell: (row) => row.customer?.name ?? "—" },
    { header: "Total", numeric: true, cell: (row) => <Money value={row.total} /> },
    { header: "Received", numeric: true, hideOnMobile: true, cell: (row) => <Money value={row.paid} /> },
    { header: "Pending", numeric: true, cell: (row) => <Money value={row.outstanding} /> },
    { header: "Status", cell: (row) => <StatusBadge status={row.paymentStatus} /> },
  ];

  return (
    <ReportShell
      title="Sales report"
      description="What you sold, what you have received, and what is still pending."
      range={range}
      onRangeChange={setRange}
      filters={<PartyFilter kind="customer" value={customer} onChange={setCustomer} />}
    >
      <StatGrid>
        <StatCard
          label="Total sales"
          icon={TrendingUp}
          isLoading={register.isLoading}
          value={<Money value={totals?.total} />}
          hint={totals ? `${totals.invoiceCount} ${totals.invoiceCount === 1 ? "bill" : "bills"}` : undefined}
        />
        <StatCard
          label="Returns"
          icon={Undo2}
          tone="dues"
          isLoading={register.isLoading}
          value={<Money value={totals?.returns} />}
          hint={totals?.returnCount != null ? `${totals.returnCount} returned` : undefined}
        />
        <StatCard
          label="Net sales"
          icon={Receipt}
          isLoading={register.isLoading}
          value={<Money value={totals?.netSales} />}
          hint="Sales less returns"
        />
        <StatCard
          label="Money received"
          icon={HandCoins}
          tone="cash"
          isLoading={received.isLoading}
          value={<Money value={received.data?.totals.amount} />}
          hint={
            received.data
              ? `${received.data.totals.receiptCount} ${received.data.totals.receiptCount === 1 ? "receipt" : "receipts"}`
              : undefined
          }
        />
      </StatGrid>

      {totals ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <SmallFigure label="Before discount and tax" value={totals.subtotal} />
          <SmallFigure label="Discount given" value={totals.discount} />
          {isGstEnabled ? <SmallFigure label="GST collected" value={totals.tax} /> : null}
          {totals.grossMargin ? (
            <SmallFigure label="Gross profit on these sales" value={totals.grossMargin} hint="Sale price less stock cost" />
          ) : null}
        </div>
      ) : null}

      <ReportSection
        title="Sales bills"
        description="Each posted bill with what has been received and what is still pending."
        contentClassName="px-3 sm:px-6"
      >
        <DataTable
          columns={columns}
          rows={register.data?.invoices}
          rowKey={(row) => row.id}
          isLoading={register.isLoading}
          error={register.error}
          onRetry={() => register.refetch()}
          onRowClick={(row) => router.push(DETAIL_ROUTES.sale(row.id))}
          mobileCard={(row) => (
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{row.customer?.name ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.invoiceNumber} · {formatDate(row.invoiceDate)}
                  </p>
                </div>
                <StatusBadge status={row.paymentStatus} />
              </div>
              <PaidDue total={row.total} paid={row.paid} due={row.outstanding} />
            </div>
          )}
          pagination={
            register.data?.pagination
              ? {
                  page: register.data.pagination.page,
                  totalPages: register.data.pagination.totalPages,
                  total: register.data.pagination.total,
                  onPageChange: list.setPage,
                }
              : undefined
          }
          emptyTitle="No sales in this period"
          emptyDescription="Posted sales bills appear here. Try a wider date range, or make a sale."
          emptyAction={
            <Button asChild>
              <Link href={ROUTES.newSale}>New sale</Link>
            </Button>
          }
        />
      </ReportSection>

      <ReportSection title="Money received, by method" description="Payments from customers in this period.">
        <MethodBreakdown
          rows={received.data?.byMethod}
          isLoading={received.isLoading}
          error={received.error}
          onRetry={() => received.refetch()}
          emptyText="No money received in this period."
        />
        {received.data ? (
          <ReportNote>
            Of this, <Money value={received.data.totals.againstInvoices} /> was set against bills and{" "}
            <Money value={received.data.totals.advance} /> is advance kept as the customer&apos;s credit.
          </ReportNote>
        ) : null}
      </ReportSection>

      <NotAvailable
        features={[
          {
            title: "Sales by salesperson",
            description: "Bills do not record who made the sale yet, so this cannot be reported.",
          },
          {
            title: "Sales by item or service",
            description: "Item-wise totals are not published yet. Open a bill to see its items.",
          },
        ]}
      />
    </ReportShell>
  );
}

