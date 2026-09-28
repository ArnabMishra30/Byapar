"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { inventoryApi, warehousesApi } from "@/lib/api";
import { DataTable, useListState, type Column } from "@/components/shared/data-table";
import { DateRangeFilter, type DateRangeValue } from "@/components/shared/date-range";
import { EntitySelect } from "@/components/shared/entity-select";
import { Money } from "@/components/shared/money";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/select-native";
import { DETAIL_ROUTES } from "@/lib/constants";
import { formatDateTime } from "@/lib/utils";
import { formatQuantity, movementLabel, type MovementType } from "./stock-helpers";
import { ReferenceLink, SignedQuantity } from "./stock-ui";
import type { MovementRow } from "./types";

/** Active warehouses, for filters and forms. One cached query for the area. */
export function useWarehouses() {
  return useQuery({
    queryKey: ["warehouses", "options"],
    queryFn: () => warehousesApi.list({ limit: 100, isActive: "true" }),
    staleTime: 60_000,
  });
}

export type MovementColumnSet = "in" | "out" | "adjustment" | "all";

/**
 * The stock movement ledger, filtered.
 *
 * Every figure is the backend's: quantity, cost and the before/after quantity
 * are read straight off the movement row. Filters are all server-side
 * (type, product, warehouse, date), so paging stays correct.
 */
export function MovementList({
  types,
  columnSet,
  productId: fixedProductId,
  withFilters = true,
  limit = 20,
  emptyTitle,
  emptyDescription,
  emptyAction,
}: {
  /** One or more types the user can switch between. First is the default. */
  types: (MovementType | "")[];
  columnSet: MovementColumnSet;
  /** Pinned product (product detail page). Hides the product filter. */
  productId?: string;
  withFilters?: boolean;
  limit?: number;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
}) {
  const list = useListState({ limit });
  const [type, setType] = React.useState<MovementType | "">(types[0] ?? "");
  const [product, setProduct] = React.useState<{ id: string; name: string } | null>(null);
  const [warehouseId, setWarehouseId] = React.useState("");
  const [range, setRange] = React.useState<DateRangeValue>({});
  const warehouses = useWarehouses();

  const productId = fixedProductId ?? product?.id;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [
      "stock-movements",
      columnSet,
      type,
      productId,
      warehouseId,
      range.fromDate,
      range.toDate,
      list.page,
      list.limit,
    ],
    queryFn: () =>
      inventoryApi.movements({
        page: list.page,
        limit: list.limit,
        type: type || undefined,
        productId,
        warehouseId: warehouseId || undefined,
        // The backend filters on when the movement was recorded (createdAt).
        fromDate: range.fromDate ? `${range.fromDate}T00:00:00` : undefined,
        toDate: range.toDate ? `${range.toDate}T23:59:59.999` : undefined,
      }) as Promise<{ items: MovementRow[]; pagination: { page: number; totalPages: number; total: number } }>,
  });

  const resetPage = () => list.setPage(1);
  const hasFilter = Boolean(product || warehouseId || range.fromDate || range.toDate);

  const productCell = (row: MovementRow) =>
    row.product ? (
      <Link
        href={DETAIL_ROUTES.product(row.product.id)}
        className="block max-w-[14rem] truncate font-medium text-foreground hover:text-primary"
      >
        {row.product.name}
      </Link>
    ) : (
      "—"
    );

  const columns: Column<MovementRow>[] = [
    {
      header: "Date",
      cell: (row) => <span className="whitespace-nowrap">{formatDateTime(row.createdAt)}</span>,
    },
  ];
  if (!fixedProductId) columns.push({ header: "Product", cell: productCell });
  if (columnSet === "all" || columnSet === "adjustment" || types.length > 1) {
    columns.push({ header: "Type", cell: (row) => movementLabel(row.type), hideOnMobile: true });
  }
  columns.push({
    header: "Quantity",
    numeric: true,
    cell: (row) => <SignedQuantity type={row.type} quantity={row.quantity} />,
  });
  if (columnSet !== "out") {
    columns.push({
      header: "Cost / unit",
      numeric: true,
      hideOnMobile: true,
      cell: (row) => <Money value={row.unitCost} />,
    });
  }
  if (columnSet === "all" || columnSet === "adjustment") {
    columns.push({
      header: "Stock after",
      numeric: true,
      hideOnMobile: true,
      cell: (row) => <span className="tabular">{formatQuantity(row.quantityAfter)}</span>,
    });
  }
  columns.push({ header: "Warehouse", hideOnMobile: true, cell: (row) => row.warehouse?.name ?? "—" });
  if (columnSet === "adjustment") {
    columns.push({
      header: "Reason / notes",
      cell: (row) => (
        <span className="block max-w-[16rem] truncate text-muted-foreground">{row.notes || "—"}</span>
      ),
    });
  } else {
    columns.push({
      header: "Reference",
      cell: (row) => <ReferenceLink referenceType={row.referenceType} referenceId={row.referenceId} />,
    });
  }
  columns.push({
    header: columnSet === "out" ? "Billed by" : "By",
    hideOnMobile: true,
    cell: (row) => row.createdBy?.name ?? "—",
  });

  return (
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
        withFilters ? (
          <div className="grid w-full gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center">
            {types.length > 1 ? (
              <NativeSelect
                aria-label="Type"
                value={type}
                onChange={(e) => {
                  setType(e.target.value as MovementType | "");
                  resetPage();
                }}
                className="lg:w-48"
              >
                {types.map((t) => (
                  <option key={t || "all"} value={t}>
                    {t ? movementLabel(t) : "All types"}
                  </option>
                ))}
              </NativeSelect>
            ) : null}
            {!fixedProductId ? (
              <div className="lg:w-56">
                <EntitySelect
                  kind="product"
                  value={product?.id}
                  valueLabel={product?.name}
                  placeholder="All products"
                  onChange={(id, name) => {
                    setProduct({ id, name });
                    resetPage();
                  }}
                />
              </div>
            ) : null}
            <NativeSelect
              aria-label="Warehouse"
              value={warehouseId}
              onChange={(e) => {
                setWarehouseId(e.target.value);
                resetPage();
              }}
              className="lg:w-48"
            >
              <option value="">All warehouses</option>
              {(warehouses.data?.items ?? []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </NativeSelect>
            <div className="min-w-0 sm:col-span-2 lg:col-span-1">
              <DateRangeFilter
                value={range}
                onChange={(next) => {
                  setRange(next);
                  resetPage();
                }}
              />
            </div>
            {hasFilter ? (
              <Button
                type="button"
                variant="ghost"
                className="min-h-[44px]"
                onClick={() => {
                  setProduct(null);
                  setWarehouseId("");
                  setRange({});
                  resetPage();
                }}
              >
                <X className="h-4 w-4" /> Clear
              </Button>
            ) : null}
          </div>
        ) : undefined
      }
      mobileCard={(row) => (
        <div className="space-y-1.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {fixedProductId ? (
                <p className="text-sm font-medium">{movementLabel(row.type)}</p>
              ) : (
                productCell(row)
              )}
              <p className="text-xs text-muted-foreground">
                {formatDateTime(row.createdAt)} · {row.warehouse?.name ?? "—"}
              </p>
            </div>
            <SignedQuantity type={row.type} quantity={row.quantity} />
          </div>
          <div className="flex items-center justify-between gap-3 text-xs">
            {columnSet === "adjustment" ? (
              <span className="min-w-0 truncate text-muted-foreground">{row.notes || "No notes"}</span>
            ) : (
              <ReferenceLink referenceType={row.referenceType} referenceId={row.referenceId} />
            )}
            <span className="shrink-0 text-muted-foreground">
              {columnSet === "out" ? "Billed by " : "By "}
              {row.createdBy?.name ?? "—"}
            </span>
          </div>
        </div>
      )}
      emptyTitle={hasFilter ? "Nothing matches these filters" : emptyTitle}
      emptyDescription={hasFilter ? "Try a different product, warehouse or date." : emptyDescription}
      emptyAction={hasFilter ? undefined : emptyAction}
    />
  );
}
