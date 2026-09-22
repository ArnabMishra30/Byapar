"use client";

import React, { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "./empty-state";
import { ErrorState } from "./error-state";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface Column<T> {
  header: string;
  accessorKey?: keyof T | string;
  cell?: (row: T) => React.ReactNode;
  sortable?: boolean;
  className?: string;
  headerClassName?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  isLoading?: boolean;
  isError?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  // Search
  searchable?: boolean;
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (val: string) => void;
  // Filters slot
  filterSlot?: React.ReactNode;
  // Actions slot
  actionSlot?: React.ReactNode;
  // Pagination
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    onPageChange: (page: number) => void;
  };
  // Empty state
  emptyTitle?: string;
  emptyDescription?: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
  /**
   * How one row looks on a phone.
   *
   * The platform console is used mostly at a desk, but a sales rep checks a
   * shop's subscription standing in a shop, on a phone. A page that supplies
   * this gets a stacked card list below `sm`; one that does not keeps the
   * scrolling table, so this is additive.
   */
  mobileCard?: (row: T) => React.ReactNode;

  // Row key
  keyExtractor?: (row: T, index: number) => string | number;
  className?: string;
}

export function DataTable<T extends Record<string, any>>({
  columns,
  data,
  isLoading = false,
  isError = false,
  error,
  onRetry,
  searchable = true,
  searchPlaceholder = "Search records...",
  searchValue = "",
  onSearchChange,
  filterSlot,
  actionSlot,
  pagination,
  emptyTitle = "No records found",
  emptyDescription = "There are currently no items matching your criteria.",
  emptyActionLabel,
  onEmptyAction,
  mobileCard,
  keyExtractor = (row, i) => row.id || i,
  className,
}: DataTableProps<T>) {
  const [internalSearch, setInternalSearch] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const currentSearch = onSearchChange ? searchValue : internalSearch;

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (onSearchChange) {
      onSearchChange(val);
    } else {
      setInternalSearch(val);
    }
  };

  const handleSort = (key?: string) => {
    if (!key) return;
    if (sortKey === key) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
  };

  // Client-side filtering & sorting if onSearchChange is not passed
  let processedData = [...(data || [])];
  if (!onSearchChange && currentSearch) {
    const query = currentSearch.toLowerCase();
    processedData = processedData.filter((item) =>
      Object.values(item).some((val) =>
        String(val || "").toLowerCase().includes(query)
      )
    );
  }

  if (sortKey) {
    processedData.sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (aVal === bVal) return 0;
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
      }
      return sortDirection === "asc"
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });
  }

  return (
    <div className={cn("space-y-4", className)}>
      {/* Controls Bar: Search, Filters, Actions */}
      {(searchable || filterSlot || actionSlot) && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 flex-wrap items-center gap-2">
            {searchable && (
              <div className="relative w-full max-w-sm">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={searchPlaceholder}
                  value={currentSearch}
                  onChange={handleSearchChange}
                  className="pl-9 h-9 text-sm"
                />
              </div>
            )}
            {filterSlot}
          </div>
          {actionSlot && (
            <div className="flex items-center gap-2 self-start sm:self-auto">
              {actionSlot}
            </div>
          )}
        </div>
      )}

      {/* Table Content */}
      {isError ? (
        <ErrorState
          title="Failed to load table data"
          message={error?.message || "An error occurred while loading data."}
          onRetry={onRetry}
        />
      ) : (
        <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
          {/* One card per row on a phone, when the page has said how a row
              should look. Reading down beats scrolling sideways. */}
          {mobileCard && !isLoading && data.length > 0 ? (
            <ul className="divide-y sm:hidden">
              {data.map((row, index) => (
                <li key={keyExtractor(row, index)} className="p-3">
                  {mobileCard(row)}
                </li>
              ))}
            </ul>
          ) : null}

          <div className={cn("overflow-x-auto", mobileCard && "hidden sm:block")}>
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((col, idx) => (
                    <TableHead
                      key={idx}
                      className={cn("whitespace-nowrap font-semibold", col.headerClassName)}
                    >
                      {col.sortable && col.accessorKey ? (
                        <button
                          type="button"
                          onClick={() => handleSort(String(col.accessorKey))}
                          className="flex items-center gap-1.5 hover:text-foreground transition-colors"
                        >
                          <span>{col.header}</span>
                          {sortKey === col.accessorKey ? (
                            sortDirection === "asc" ? (
                              <ArrowUp className="w-3.5 h-3.5" />
                            ) : (
                              <ArrowDown className="w-3.5 h-3.5" />
                            )
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-40" />
                          )}
                        </button>
                      ) : (
                        col.header
                      )}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, rIdx) => (
                    <TableRow key={rIdx}>
                      {columns.map((_, cIdx) => (
                        <TableCell key={cIdx}>
                          <Skeleton className="h-5 w-full max-w-[140px]" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : processedData.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length}
                      className="h-48 text-center"
                    >
                      <EmptyState
                        title={emptyTitle}
                        description={emptyDescription}
                        actionLabel={emptyActionLabel}
                        onAction={onEmptyAction}
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  processedData.map((row, rIdx) => (
                    <TableRow
                      key={keyExtractor(row, rIdx)}
                      className="transition-colors hover:bg-muted/40"
                    >
                      {columns.map((col, cIdx) => (
                        <TableCell
                          key={cIdx}
                          className={cn("text-sm", col.className)}
                        >
                          {col.cell
                            ? col.cell(row)
                            : col.accessorKey
                            ? String(row[col.accessorKey] ?? "—")
                            : null}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination Bar */}
          {pagination && pagination.totalPages > 1 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t bg-muted/20 text-xs text-muted-foreground">
              <div>
                Showing page <span className="font-semibold text-foreground">{pagination.page}</span> of{" "}
                <span className="font-semibold text-foreground">{pagination.totalPages}</span> (
                {pagination.total} total items)
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  disabled={pagination.page <= 1 || isLoading}
                  onClick={() => pagination.onPageChange(1)}
                  title="First Page"
                >
                  <ChevronsLeft className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  disabled={pagination.page <= 1 || isLoading}
                  onClick={() => pagination.onPageChange(pagination.page - 1)}
                  title="Previous Page"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="px-2 py-1 font-medium text-foreground">
                  {pagination.page}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  disabled={pagination.page >= pagination.totalPages || isLoading}
                  onClick={() => pagination.onPageChange(pagination.page + 1)}
                  title="Next Page"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  disabled={pagination.page >= pagination.totalPages || isLoading}
                  onClick={() => pagination.onPageChange(pagination.totalPages)}
                  title="Last Page"
                >
                  <ChevronsRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
