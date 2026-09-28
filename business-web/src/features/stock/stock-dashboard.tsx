"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  IndianRupee,
  Layers,
  Package,
  PackageX,
  Plus,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { inventoryApi, productsApi, stockApi } from "@/lib/api";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { DataTable, useListState, type Column } from "@/components/shared/data-table";
import { EntitySelect } from "@/components/shared/entity-select";
import { Money } from "@/components/shared/money";
import { NotAvailable } from "@/components/shared/not-available";
import { Can } from "@/components/shared/permission-gate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/select-native";
import { DETAIL_ROUTES, ROUTES } from "@/lib/constants";
import { formatMoney } from "@/lib/utils";
import type { StockBalance } from "@/types/api";
import { formatQuantity, isOutOfStock, todayRange } from "./stock-helpers";
import { MovementList, useWarehouses } from "./movement-list";
import { OpeningStockDialog } from "./opening-stock-dialog";
import { StockLevelBadge, StockTabs } from "./stock-ui";

/**
 * Stock at a glance.
 *
 * Value, line count and low-stock count are the inventory valuation report's
 * own totals - the same moving weighted average the books use. The page only
 * counts rows (out of stock, today's entries); it never adds up money or
 * quantities, because quantities in different units cannot be added.
 */
export function StockDashboard() {
  const [openingOpen, setOpeningOpen] = React.useState(false);
  const today = React.useMemo(() => todayRange(), []);

  const products = useQuery({
    queryKey: ["products", "count"],
    queryFn: () => productsApi.list({ limit: 1 }),
  });

  const valuation = useQuery({
    queryKey: ["inventory-valuation", "all"],
    queryFn: () => stockApi.valuation(),
  });

  // Counts of today's entries, not quantities: pagination.total is a row count.
  const todayIn = useQuery({
    queryKey: ["stock-movements", "today", "STOCK_IN", today.fromDate],
    queryFn: () => inventoryApi.movements({ limit: 1, type: "STOCK_IN", ...today }),
  });
  const todayOut = useQuery({
    queryKey: ["stock-movements", "today", "STOCK_OUT", today.fromDate],
    queryFn: () => inventoryApi.movements({ limit: 1, type: "STOCK_OUT", ...today }),
  });

  const outOfStock = valuation.data?.items.filter((item) => isOutOfStock(item.quantity)).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock"
        description="What you have, what it is worth, and what is running low."
        actions={
          <Can do="products.manage">
            <Button asChild className="min-h-[44px]">
              <Link href={`${ROUTES.products}?new=1`}>
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">Add product</span>
                <span className="sm:hidden">Add</span>
              </Link>
            </Button>
          </Can>
        }
      />
      <StockTabs />

      <Can do="inventory.adjust">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild className="min-h-[44px]">
            <Link href={ROUTES.stockAdjustments}>
              <SlidersHorizontal className="h-4 w-4" /> Stock adjustment
            </Link>
          </Button>
          <Button variant="outline" className="min-h-[44px]" onClick={() => setOpeningOpen(true)}>
            <Layers className="h-4 w-4" /> Add opening stock
          </Button>
        </div>
      </Can>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Total products"
          icon={Package}
          value={products.data?.pagination.total ?? "—"}
          isLoading={products.isLoading}
          href={ROUTES.products}
        />
        <StatCard
          label="Stock value"
          icon={IndianRupee}
          tone="cash"
          value={valuation.data ? formatMoney(valuation.data.totals.totalValue) : "—"}
          hint="At average cost"
          isLoading={valuation.isLoading}
        />
        <StatCard
          label="Stock lines"
          icon={Boxes}
          value={valuation.data?.totals.itemCount ?? "—"}
          hint="Product × warehouse"
          isLoading={valuation.isLoading}
        />
        <StatCard
          label="Low stock"
          icon={AlertTriangle}
          tone="credit"
          value={valuation.data?.totals.lowStockCount ?? "—"}
          hint="Tap to reorder"
          isLoading={valuation.isLoading}
          href={ROUTES.lowStock}
        />
        <StatCard
          label="Out of stock"
          icon={PackageX}
          tone="dues"
          value={outOfStock ?? "—"}
          hint="Zero or less in stock"
          isLoading={valuation.isLoading}
        />
        <StatCard
          label="Today's entries"
          icon={ArrowDownToLine}
          value={
            todayIn.data && todayOut.data ? (
              <span className="flex items-center gap-2">
                <span className="text-success">{todayIn.data.pagination.total} in</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-destructive">{todayOut.data.pagination.total} out</span>
              </span>
            ) : (
              "—"
            )
          }
          hint="Number of stock entries"
          isLoading={todayIn.isLoading || todayOut.isLoading}
        />
      </div>

      <CurrentStockCard />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ArrowUpFromLine className="h-4 w-4 text-muted-foreground" aria-hidden />
            Recent stock movements
          </CardTitle>
          <Button variant="ghost" size="sm" asChild>
            <Link href={ROUTES.stockIn}>See all</Link>
          </Button>
        </CardHeader>
        <CardContent>
          <MovementList
            types={[""]}
            columnSet="all"
            withFilters={false}
            limit={10}
            emptyTitle="No stock movements yet"
            emptyDescription="Purchases, sales, opening stock and adjustments will show here."
          />
        </CardContent>
      </Card>

      <NotAvailable
        features={[
          {
            title: "Total stock quantity",
            description:
              "Not shown: products are counted in different units (pcs, kg, litre), so one total would be misleading.",
          },
          {
            title: "Stock transfer between warehouses",
            description: "Use a stock adjustment to remove from one warehouse and add to the other.",
          },
          {
            title: "Batch, expiry and 'expiring soon'",
            description: "Stock is tracked per product and warehouse, not per batch or expiry date.",
          },
          {
            title: "Damaged and reserved stock",
            description: "Record damaged stock as an adjustment with the reason 'Damaged'.",
          },
          {
            title: "Today's stock in / out quantities",
            description: "Only the number of entries is shown, because units differ between products.",
          },
          {
            title: "MRP, brand, image and rack / shelf",
            description: "Products store name, code, barcode, category, unit, tax and prices only.",
          },
        ]}
      />

      <OpeningStockDialog open={openingOpen} onOpenChange={setOpeningOpen} />
    </div>
  );
}

/**
 * Current stock per product and warehouse.
 *
 * The backend has no text search on balances, so the filter is a product
 * picker (which does search) plus a warehouse select - both sent to the server.
 */
function CurrentStockCard() {
  const list = useListState({ limit: 20 });
  const [product, setProduct] = React.useState<{ id: string; name: string } | null>(null);
  const [warehouseId, setWarehouseId] = React.useState("");
  const warehouses = useWarehouses();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["inventory", "balances", list.page, product?.id, warehouseId],
    queryFn: () =>
      inventoryApi.balances({
        page: list.page,
        limit: list.limit,
        productId: product?.id,
        warehouseId: warehouseId || undefined,
      }),
  });

  const hasFilter = Boolean(product || warehouseId);

  const columns: Column<StockBalance>[] = [
    {
      header: "Product",
      cell: (row) => (
        <Link href={DETAIL_ROUTES.product(row.product.id)} className="block min-w-0 hover:text-primary">
          <span className="block truncate font-medium">{row.product.name}</span>
          {row.product.sku ? (
            <span className="block text-xs text-muted-foreground">{row.product.sku}</span>
          ) : null}
        </Link>
      ),
    },
    { header: "Warehouse", hideOnMobile: true, cell: (row) => row.warehouse.name },
    {
      header: "In stock",
      numeric: true,
      cell: (row) => <span className="tabular font-medium">{formatQuantity(row.quantity)}</span>,
    },
    {
      header: "Min. level",
      numeric: true,
      hideOnMobile: true,
      cell: (row) => <span className="tabular">{formatQuantity(row.product.reorderLevel ?? 0)}</span>,
    },
    { header: "Avg. cost", numeric: true, hideOnMobile: true, cell: (row) => <Money value={row.averageCost} /> },
    { header: "Value", numeric: true, cell: (row) => <Money value={row.inventoryValue} /> },
    {
      header: "Status",
      cell: (row) => <StockLevelBadge quantity={row.quantity} reorderLevel={row.product.reorderLevel} />,
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Boxes className="h-4 w-4 text-muted-foreground" aria-hidden />
          Current stock
        </CardTitle>
      </CardHeader>
      <CardContent>
        <DataTable
          columns={columns}
          rows={data?.items}
          rowKey={(row) => row.id}
          isLoading={isLoading}
          error={error}
          onRetry={() => refetch()}
          pagination={
            data?.pagination
              ? {
                  page: list.page,
                  totalPages: data.pagination.totalPages,
                  total: data.pagination.total,
                  onPageChange: list.setPage,
                }
              : undefined
          }
          filters={
            <div className="grid w-full gap-2 sm:grid-cols-3 sm:items-center">
              <EntitySelect
                kind="product"
                value={product?.id}
                valueLabel={product?.name}
                placeholder="Find a product"
                onChange={(id, name) => {
                  setProduct({ id, name });
                  list.setPage(1);
                }}
              />
              <NativeSelect
                aria-label="Warehouse"
                value={warehouseId}
                onChange={(e) => {
                  setWarehouseId(e.target.value);
                  list.setPage(1);
                }}
              >
                <option value="">All warehouses</option>
                {(warehouses.data?.items ?? []).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </NativeSelect>
              {hasFilter ? (
                <Button
                  variant="ghost"
                  className="min-h-[44px] justify-self-start"
                  onClick={() => {
                    setProduct(null);
                    setWarehouseId("");
                    list.setPage(1);
                  }}
                >
                  <X className="h-4 w-4" /> Clear
                </Button>
              ) : null}
            </div>
          }
          mobileCard={(row) => (
            <Link href={DETAIL_ROUTES.product(row.product.id)} className="block space-y-1.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{row.product.name}</p>
                  <p className="text-xs text-muted-foreground">{row.warehouse.name}</p>
                </div>
                <StockLevelBadge quantity={row.quantity} reorderLevel={row.product.reorderLevel} />
              </div>
              <div className="flex items-center justify-between text-sm">
                <span>
                  In stock <span className="tabular font-semibold">{formatQuantity(row.quantity)}</span>
                </span>
                <Money value={row.inventoryValue} className="font-medium" />
              </div>
            </Link>
          )}
          emptyTitle={hasFilter ? "No stock for this filter" : "No stock recorded yet"}
          emptyDescription={
            hasFilter
              ? "This product has no stock in that warehouse yet."
              : "Add opening stock or record a purchase to see stock here."
          }
          emptyAction={
            hasFilter ? undefined : (
              <Can do="purchases.draft">
                <Button asChild size="sm">
                  <Link href={ROUTES.newPurchase}>Record a purchase</Link>
                </Button>
              </Can>
            )
          }
        />
      </CardContent>
    </Card>
  );
}
