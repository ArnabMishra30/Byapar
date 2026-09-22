"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ErrorState, LoadingState, EmptyState, NoResultsState } from "./states";
import { cn } from "@/lib/utils";

/**
 * The table every list screen will use.
 *
 * Built once here so Sales, Purchases, Customers, Suppliers, Stock, Credit,
 * Expenses and Reports all behave identically - same pagination, same search,
 * same states, same behaviour on a phone.
 *
 * TWO RULES IT ENFORCES FOR ITS CALLERS:
 *
 *   Sorting and paging are SERVER-side. The component reports what the user did
 *   and renders what comes back; it never sorts or slices a page in the browser,
 *   because page 2 of a client-sorted list is a different list.
 *
 *   Changing a search or a filter RESETS to page 1. Staying on page 7 of a list
 *   that now has two pages shows an empty screen and looks broken.
 */

export interface Column<T> {
  /** Column heading. */
  header: string;
  /** Renders the cell. */
  cell: (row: T) => React.ReactNode;
  /** Field name sent to the backend when this column is sorted. */
  sortKey?: string;
  /** Right-align, for money and counts. */
  numeric?: boolean;
  /** Hidden below `sm`, so a phone shows only what matters. */
  hideOnMobile?: boolean;
  className?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;

  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;

  /** Search box. Debounce upstream; this only reports changes. */
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;

  sort?: { key: string; direction: "asc" | "desc" };
  onSortChange?: (sort: { key: string; direction: "asc" | "desc" }) => void;

  pagination?: {
    page: number;
    totalPages: number;
    total: number;
    onPageChange: (page: number) => void;
  };

  /** Extra controls (status filters, date range) beside the search box. */
  filters?: React.ReactNode;

  /**
   * How one row looks on a phone.
   *
   * WHY THIS EXISTS. Eight columns inside a 320px scroll container is
   * technically not broken - the page does not overflow - but it is miserable
   * to use: you scroll sideways to read one row, then back to read the next.
   *
   * A page that supplies this gets a stacked CARD LIST below `sm` and the
   * ordinary table from `sm` up. A page that does not keeps the scrolling
   * table, so this is additive and nothing had to change to keep working.
   */
  mobileCard?: (row: T) => React.ReactNode;
  onRowClick?: (row: T) => void;

  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  isLoading,
  error,
  onRetry,
  search,
  onSearchChange,
  searchPlaceholder = "Search…",
  sort,
  onSortChange,
  pagination,
  filters,
  mobileCard,
  onRowClick,
  emptyTitle,
  emptyDescription,
  emptyAction,
}: DataTableProps<T>) {
  const isSearching = Boolean(search && search.length > 0);

  const toggleSort = (key: string) => {
    if (!onSortChange) return;
    const direction = sort?.key === key && sort.direction === "asc" ? "desc" : "asc";
    onSortChange({ key, direction });
  };

  const hasControls = Boolean(onSearchChange || filters);

  return (
    <div className="space-y-4">
      {hasControls ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {onSearchChange ? (
            <div className="relative w-full sm:max-w-xs">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={search ?? ""}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder={searchPlaceholder}
                className="pl-9"
                aria-label="Search"
              />
            </div>
          ) : (
            <div />
          )}
          {filters ? (
            <div className="flex flex-wrap items-center gap-2">{filters}</div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <ErrorState error={error} onRetry={onRetry} />
      ) : isLoading ? (
        <LoadingState rows={4} />
      ) : !rows || rows.length === 0 ? (
        isSearching ? (
          <NoResultsState onClear={() => onSearchChange?.("")} />
        ) : (
          <EmptyState
            title={emptyTitle ?? "Nothing here yet"}
            description={emptyDescription}
            action={emptyAction}
          />
        )
      ) : (
        <div className="rounded-xl border bg-card">
          {/* A phone gets one card per row, when the page has said how a row
              should look. Reading top to bottom beats scrolling sideways. */}
          {mobileCard ? (
            <ul className="divide-y sm:hidden">
              {rows.map((row) => (
                <li
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn("p-3", onRowClick && "cursor-pointer active:bg-muted/50")}
                >
                  {mobileCard(row)}
                </li>
              ))}
            </ul>
          ) : null}

          {/* The one thing that keeps a wide table from pushing the page
              sideways on a phone: the table scrolls, the page does not. */}
          <div className={cn("w-full overflow-x-auto", mobileCard && "hidden sm:block")}>
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((column) => {
                    const sortable = Boolean(column.sortKey && onSortChange);
                    const active = sort?.key === column.sortKey;

                    return (
                      <TableHead
                        key={column.header}
                        className={cn(
                          column.numeric && "text-right",
                          column.hideOnMobile && "hidden sm:table-cell",
                          column.className,
                        )}
                        aria-sort={
                          active ? (sort?.direction === "asc" ? "ascending" : "descending") : undefined
                        }
                      >
                        {sortable ? (
                          <button
                            type="button"
                            onClick={() => toggleSort(column.sortKey!)}
                            className={cn(
                              "inline-flex items-center gap-1 transition-colors hover:text-foreground",
                              column.numeric && "flex-row-reverse",
                            )}
                          >
                            {column.header}
                            {active ? (
                              sort?.direction === "asc" ? (
                                <ArrowUp className="h-3 w-3" />
                              ) : (
                                <ArrowDown className="h-3 w-3" />
                              )
                            ) : null}
                          </button>
                        ) : (
                          column.header
                        )}
                      </TableHead>
                    );
                  })}
                </TableRow>
              </TableHeader>

              <TableBody>
                {rows.map((row) => (
                  <TableRow
                    key={rowKey(row)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn(onRowClick && "cursor-pointer")}
                  >
                    {columns.map((column) => (
                      <TableCell
                        key={column.header}
                        className={cn(
                          column.numeric && "text-right tabular",
                          column.hideOnMobile && "hidden sm:table-cell",
                          column.className,
                        )}
                      >
                        {column.cell(row)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {pagination && pagination.totalPages > 1 ? (
        <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
          <p className="text-xs text-muted-foreground">
            Page {pagination.page} of {pagination.totalPages} · {pagination.total} total
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              disabled={pagination.page <= 1}
              onClick={() => pagination.onPageChange(pagination.page - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => pagination.onPageChange(pagination.page + 1)}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * List state in one hook, so every screen gets the "filters reset the page"
 * rule for free rather than each remembering to do it.
 */
export function useListState(initial?: { limit?: number; sortKey?: string }) {
  const [page, setPage] = React.useState(1);
  const [search, setSearchValue] = React.useState("");
  const [sort, setSortValue] = React.useState<{ key: string; direction: "asc" | "desc" } | undefined>(
    initial?.sortKey ? { key: initial.sortKey, direction: "desc" } : undefined,
  );

  const setSearch = React.useCallback((value: string) => {
    setSearchValue(value);
    setPage(1);
  }, []);

  const setSort = React.useCallback((next: { key: string; direction: "asc" | "desc" }) => {
    setSortValue(next);
    setPage(1);
  }, []);

  return {
    page,
    setPage,
    search,
    setSearch,
    sort,
    setSort,
    limit: initial?.limit ?? 20,
  };
}
