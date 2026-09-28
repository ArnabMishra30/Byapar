"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Boxes, Package, TriangleAlert } from "lucide-react";
import { stockApi, type ValuationItem } from "@/lib/api";
import { DETAIL_ROUTES, ROUTES } from "@/lib/constants";
import { formatDate, formatAmount } from "@/lib/utils";
import { DataTable, type Column } from "@/components/shared/data-table";
import { StatCard } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { NotAvailable } from "@/components/shared/not-available";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ReportNote, ReportSection, ReportShell, StatGrid, ToggleChip } from "./report-shell";

function storeName(warehouse: ValuationItem["warehouse"]): string {
  if (!warehouse) return "—";
  return typeof warehouse === "string" ? warehouse : warehouse.name;
}

/** Quantities arrive as "12.000"; show "12" without doing arithmetic on them. */
function qty(value: string | null | undefined): string {
  if (value == null) return "—";
  return value.includes(".") ? value.replace(/\.?0+$/, "") || "0" : value;
}

/**
 * Stock report: what is on the shelf right now and what it is worth.
 *
 * The value is the backend's moving-average cost figure, the same one the
 * books carry. It is "as of now" - there is no date range, because the
 * backend values current stock only.
 */
export function StockReport() {
  const router = useRouter();
  const [lowStockOnly, setLowStockOnly] = React.useState(false);

  const valuation = useQuery({
    queryKey: ["report", "stock-valuation", lowStockOnly],
    queryFn: () => stockApi.valuation({ lowStockOnly }),
  });

  const totals = valuation.data?.totals;

  const columns: Column<ValuationItem>[] = [
    {
      header: "Item",
      cell: (row) => (
        <span className="block">
          <span className="block font-medium">{row.product}</span>
          {row.sku ? <span className="block text-xs text-muted-foreground">{row.sku}</span> : null}
        </span>
      ),
    },
    { header: "Store", hideOnMobile: true, cell: (row) => storeName(row.warehouse) },
    { header: "In stock", numeric: true, cell: (row) => qty(row.quantity) },
    { header: "Average cost", numeric: true, hideOnMobile: true, cell: (row) => formatAmount(row.averageCost) },
    { header: "Value", numeric: true, cell: (row) => <Money value={row.value} /> },
    {
      header: "",
      cell: (row) => (row.isLowStock ? <Badge variant="warning">Low stock</Badge> : null),
    },
  ];

  return (
    <ReportShell
      title="Stock report"
      description="What you have in stock right now and what it is worth."
      filters={
        <ToggleChip pressed={lowStockOnly} onPressedChange={setLowStockOnly}>
          <TriangleAlert className="h-4 w-4" aria-hidden />
          Low stock only
        </ToggleChip>
      }
    >
      <StatGrid>
        <StatCard
          label={lowStockOnly ? "Value of low-stock items" : "Stock value"}
          icon={Boxes}
          isLoading={valuation.isLoading}
          value={<Money value={totals?.totalValue} />}
          hint={valuation.data ? `As of ${formatDate(valuation.data.asOf)}` : undefined}
        />
        <StatCard
          label="Items listed"
          icon={Package}
          isLoading={valuation.isLoading}
          value={totals?.itemCount ?? "—"}
          hint="One line per item per store"
        />
        <StatCard
          label="Running low"
          icon={TriangleAlert}
          tone="credit"
          isLoading={valuation.isLoading}
          value={totals?.lowStockCount ?? "—"}
          hint="At or below reorder level"
        />
      </StatGrid>

      <ReportSection title="Items in stock" contentClassName="px-3 sm:px-6">
        <DataTable
          columns={columns}
          rows={valuation.data?.items}
          rowKey={(row) => `${row.productId}-${storeName(row.warehouse)}`}
          isLoading={valuation.isLoading}
          error={valuation.error}
          onRetry={() => valuation.refetch()}
          onRowClick={(row) => router.push(DETAIL_ROUTES.product(row.productId))}
          mobileCard={(row) => (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{row.product}</p>
                <p className="text-xs text-muted-foreground">
                  {qty(row.quantity)} in stock · {storeName(row.warehouse)}
                </p>
                {row.isLowStock ? (
                  <Badge variant="warning" className="mt-1">
                    Low stock
                  </Badge>
                ) : null}
              </div>
              <Money value={row.value} className="shrink-0 font-semibold" />
            </div>
          )}
          emptyTitle={lowStockOnly ? "Nothing is running low" : "No stock yet"}
          emptyDescription={
            lowStockOnly
              ? "Every item is above its reorder level."
              : "Add items and record a purchase or opening stock to see them here."
          }
          emptyAction={
            lowStockOnly ? undefined : (
              <Button asChild>
                <Link href={`${ROUTES.products}?new=1`}>Add item</Link>
              </Button>
            )
          }
        />
        <div className="mt-3">
          <ReportNote>{valuation.data?.note}</ReportNote>
        </div>
      </ReportSection>

      <NotAvailable
        features={[
          {
            title: "Stock movement by date",
            description: "A day-by-day stock report is not published yet. Stock screens show each movement.",
          },
          {
            title: "Expiry report",
            description: "Batches and expiry dates are not recorded yet.",
          },
        ]}
      />
    </ReportShell>
  );
}
