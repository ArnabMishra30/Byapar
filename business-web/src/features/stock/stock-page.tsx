"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Boxes, IndianRupee, Package } from "lucide-react";
import { inventoryApi, reportsApi } from "@/lib/api";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { DataTable, useListState, type Column } from "@/components/shared/data-table";
import { Money } from "@/components/shared/money";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatAmount, formatDateTime } from "@/lib/utils";
import type { StockBalance, StockMovement } from "@/types/api";

/**
 * Stock.
 *
 * Quantities and value both come from the inventory module, which values stock
 * at its own moving weighted average - the same figure the books use for cost of
 * goods sold. There is no second valuation here.
 */
const MOVEMENT_LABEL: Record<string, string> = {
  OPENING_STOCK: "Opening stock",
  STOCK_IN: "Stock in",
  STOCK_OUT: "Stock out",
  ADJUSTMENT_IN: "Correction (added)",
  ADJUSTMENT_OUT: "Correction (removed)",
};

export function StockPage() {
  const list = useListState({ limit: 20 });
  const movementList = useListState({ limit: 20 });

  const balances = useQuery({
    queryKey: ["inventory", list.page],
    queryFn: () => inventoryApi.balances({ page: list.page, limit: list.limit }),
  });

  const valuation = useQuery({
    queryKey: ["inventory-valuation"],
    queryFn: () =>
      reportsApi.inventoryValuation() as unknown as Promise<{
        totals: { totalValue: string; itemCount: number; lowStockCount: number };
      }>,
  });

  const movements = useQuery({
    queryKey: ["stock-movements", movementList.page],
    queryFn: () => inventoryApi.movements({ page: movementList.page, limit: movementList.limit }),
  });

  const balanceColumns: Column<StockBalance>[] = [
    {
      header: "Item",
      cell: (row) => (
        <span className="block">
          <span className="block font-medium">{row.product.name}</span>
          <span className="block text-xs text-muted-foreground">{row.product.sku}</span>
        </span>
      ),
    },
    { header: "Godown", cell: (row) => row.warehouse.name, hideOnMobile: true },
    { header: "Qty", numeric: true, cell: (row) => formatAmount(row.quantity) },
    {
      header: "Cost each",
      numeric: true,
      hideOnMobile: true,
      cell: (row) => <Money value={row.averageCost} />,
    },
    { header: "Value", numeric: true, cell: (row) => <Money value={row.inventoryValue} /> },
  ];

  const movementColumns: Column<StockMovement>[] = [
    {
      header: "When",
      cell: (row) => <span className="whitespace-nowrap">{formatDateTime(row.createdAt)}</span>,
    },
    {
      header: "Item",
      cell: (row) => <span className="block max-w-[12rem] truncate">{row.product?.name ?? "—"}</span>,
    },
    {
      header: "What happened",
      cell: (row) => MOVEMENT_LABEL[row.type] ?? row.type,
      hideOnMobile: true,
    },
    { header: "Qty", numeric: true, cell: (row) => formatAmount(row.quantity) },
    {
      header: "Value",
      numeric: true,
      hideOnMobile: true,
      cell: (row) => <Money value={row.totalCost} />,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Stock" description="What you have, and what it is worth." />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Stock value"
          value={<Money value={valuation.data?.totals.totalValue} />}
          icon={IndianRupee}
          isLoading={valuation.isLoading}
        />
        <StatCard
          label="Items in stock"
          value={valuation.data?.totals.itemCount ?? 0}
          icon={Package}
          isLoading={valuation.isLoading}
        />
        <StatCard
          label="Running low"
          value={valuation.data?.totals.lowStockCount ?? 0}
          hint="Below the reorder level"
          icon={AlertTriangle}
          tone={valuation.data?.totals.lowStockCount ? "dues" : "default"}
          isLoading={valuation.isLoading}
        />
      </div>

      <Tabs defaultValue="on-hand">
        <TabsList>
          <TabsTrigger value="on-hand" className="gap-1.5">
            <Boxes className="h-4 w-4" />
            On hand
          </TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="on-hand">
          <DataTable
            columns={balanceColumns}
            rows={balances.data?.items}
            rowKey={(row) => row.id}
            isLoading={balances.isLoading}
            error={balances.error}
            onRetry={() => balances.refetch()}
            mobileCard={(row) => (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{row.product?.name ?? "—"}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {row.warehouse?.name} · {formatAmount(row.quantity)} in stock
              </p>
            </div>
            <Money value={row.inventoryValue} className="shrink-0 text-sm font-semibold" />
          </div>
        )}
        pagination={
              balances.data?.pagination
                ? {
                    page: balances.data.pagination.page,
                    totalPages: balances.data.pagination.totalPages,
                    total: balances.data.pagination.total,
                    onPageChange: list.setPage,
                  }
                : undefined
            }
            emptyTitle="No stock yet"
            emptyDescription="Stock appears here once you post a purchase, or set an opening stock."
          />
        </TabsContent>

        <TabsContent value="history">
          <DataTable
            columns={movementColumns}
            rows={movements.data?.items}
            rowKey={(row) => row.id}
            isLoading={movements.isLoading}
            error={movements.error}
            onRetry={() => movements.refetch()}
            pagination={
              movements.data?.pagination
                ? {
                    page: movements.data.pagination.page,
                    totalPages: movements.data.pagination.totalPages,
                    total: movements.data.pagination.total,
                    onPageChange: movementList.setPage,
                  }
                : undefined
            }
            emptyTitle="Nothing has moved yet"
            emptyDescription="Every time stock comes in or goes out, it is recorded here."
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
