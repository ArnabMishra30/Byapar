"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowUpRight, ShoppingCart, Undo2, Wallet } from "lucide-react";
import { registersApi, type PurchaseRegisterRow } from "@/lib/api";
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
 * Purchase report: what was bought in the period, what has been paid to
 * suppliers, and what is still owed on each bill. Posted bills only.
 */
export function PurchaseReport() {
  const router = useRouter();
  const { isGstEnabled } = useAuth();
  const [range, setRange] = useReportRange();
  const [supplier, setSupplier] = React.useState<{ id: string; name: string } | null>(null);
  const list = useListState({ limit: 20 });
  const { setPage } = list;

  const params = { ...rangeParams(range), supplierId: supplier?.id };
  const paramsKey = JSON.stringify(params);
  React.useEffect(() => setPage(1), [paramsKey, setPage]);

  const register = useQuery({
    queryKey: ["report", "purchases", params, list.page],
    queryFn: () => registersApi.purchases({ ...params, page: list.page, limit: list.limit }),
    placeholderData: keepPreviousData,
  });

  const paid = useQuery({
    queryKey: ["report", "supplier-payments", params],
    queryFn: () => reportCalls.supplierPayments({ ...params, limit: 1 }),
  });

  const totals = register.data?.totals;

  const columns: Column<PurchaseRegisterRow>[] = [
    {
      header: "Bill no.",
      cell: (row) => (
        <span className="block">
          <span className="block font-medium">{row.purchaseNumber}</span>
          {row.supplierInvoiceNumber ? (
            <span className="block text-xs text-muted-foreground">Supplier no. {row.supplierInvoiceNumber}</span>
          ) : null}
        </span>
      ),
    },
    { header: "Date", cell: (row) => formatDate(row.invoiceDate) },
    { header: "Supplier", cell: (row) => row.supplier?.name ?? "—" },
    { header: "Total", numeric: true, cell: (row) => <Money value={row.total} /> },
    { header: "Paid", numeric: true, hideOnMobile: true, cell: (row) => <Money value={row.paid} /> },
    { header: "You owe", numeric: true, cell: (row) => <Money value={row.outstanding} /> },
    { header: "Status", cell: (row) => <StatusBadge status={row.paymentStatus} /> },
  ];

  return (
    <ReportShell
      title="Purchase report"
      description="What you bought, what you have paid, and what you still owe suppliers."
      range={range}
      onRangeChange={setRange}
      filters={<PartyFilter kind="supplier" value={supplier} onChange={setSupplier} />}
    >
      <StatGrid>
        <StatCard
          label="Total purchases"
          icon={ShoppingCart}
          isLoading={register.isLoading}
          value={<Money value={totals?.total} />}
          hint={totals ? `${totals.billCount} ${totals.billCount === 1 ? "bill" : "bills"}` : undefined}
        />
        <StatCard
          label="Returned to suppliers"
          icon={Undo2}
          isLoading={register.isLoading}
          value={<Money value={totals?.returns} />}
          hint={totals?.returnCount != null ? `${totals.returnCount} returned` : undefined}
        />
        <StatCard
          label="Net purchases"
          icon={Wallet}
          isLoading={register.isLoading}
          value={<Money value={totals?.netPurchases} />}
          hint="Purchases less returns"
        />
        <StatCard
          label="Money paid"
          icon={ArrowUpRight}
          tone="dues"
          isLoading={paid.isLoading}
          value={<Money value={paid.data?.totals.amount} />}
          hint={
            paid.data
              ? `${paid.data.totals.paymentCount} ${paid.data.totals.paymentCount === 1 ? "payment" : "payments"}`
              : undefined
          }
        />
      </StatGrid>

      {totals ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <SmallFigure label="Before discount and tax" value={totals.subtotal} />
          <SmallFigure label="Discount received" value={totals.discount} />
          {isGstEnabled ? <SmallFigure label="GST paid on purchases" value={totals.tax} /> : null}
        </div>
      ) : null}

      <ReportSection
        title="Purchase bills"
        description="Each posted bill with what has been paid and what you still owe."
        contentClassName="px-3 sm:px-6"
      >
        <DataTable
          columns={columns}
          rows={register.data?.bills}
          rowKey={(row) => row.id}
          isLoading={register.isLoading}
          error={register.error}
          onRetry={() => register.refetch()}
          onRowClick={(row) => router.push(DETAIL_ROUTES.purchase(row.id))}
          mobileCard={(row) => (
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{row.supplier?.name ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.purchaseNumber} · {formatDate(row.invoiceDate)}
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
          emptyTitle="No purchases in this period"
          emptyDescription="Posted purchase bills appear here. Try a wider date range, or record a purchase."
          emptyAction={
            <Button asChild>
              <Link href={ROUTES.newPurchase}>New purchase</Link>
            </Button>
          }
        />
      </ReportSection>

      <ReportSection title="Money paid, by method" description="Payments to suppliers in this period.">
        <MethodBreakdown
          rows={paid.data?.byMethod}
          isLoading={paid.isLoading}
          error={paid.error}
          onRetry={() => paid.refetch()}
          emptyText="No payments to suppliers in this period."
        />
        {paid.data ? (
          <ReportNote>
            Of this, <Money value={paid.data.totals.againstBills} /> was set against bills and{" "}
            <Money value={paid.data.totals.advance} /> is advance kept with the supplier.
          </ReportNote>
        ) : null}
      </ReportSection>

      <NotAvailable
        features={[
          {
            title: "Top purchased items",
            description: "Item-wise purchase totals are not published yet. Open a bill to see its items.",
          },
        ]}
      />
    </ReportShell>
  );
}
