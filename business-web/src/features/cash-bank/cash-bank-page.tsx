"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, Landmark, Wallet } from "lucide-react";
import { reportsApi } from "@/lib/api";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { DataTable, useListState, type Column } from "@/components/shared/data-table";
import { ErrorState } from "@/components/shared/states";
import { Money } from "@/components/shared/money";
import { NotAvailable } from "@/components/shared/not-available";
import { DateRangeFilter, type DateRangeValue } from "@/components/shared/date-range";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DETAIL_ROUTES } from "@/lib/constants";
import { formatDate, startOfMonth, toInputDate } from "@/lib/utils";
import { MoneyTabs } from "@/features/money/money-tabs";
import type { Pagination } from "@/types/api";

/**
 * Cash and bank.
 *
 * Every figure is the general ledger's own answer: opening, money in, money
 * out and closing for each account come from the backend, and each movement
 * names the document behind it. Nothing is added up in the browser.
 *
 * "Money in" and "money out" rather than "debit" and "credit" - the same two
 * columns, in words a shopkeeper uses.
 */
interface CashAccount {
  code: string;
  name: string;
  openingBalance: string;
  moneyIn: string;
  moneyOut: string;
  closingBalance: string;
}

interface Movement {
  date: string;
  account: { code: string; name: string };
  journalNumber: string;
  description: string | null;
  sourceType: string;
  sourceId?: string | null;
  moneyIn: string;
  moneyOut: string;
}

interface CashBankReport {
  accounts: CashAccount[];
  movements: Movement[];
  pagination?: Pagination;
  totals: { openingBalance: string; moneyIn: string; moneyOut: string; netMovement: string; closingBalance: string };
  note?: string;
}

const SOURCE_LABEL: Record<string, string> = {
  SALES_INVOICE: "Sale",
  PURCHASE: "Purchase",
  CUSTOMER_PAYMENT: "Money received",
  SUPPLIER_PAYMENT: "Money paid",
  EXPENSE: "Expense",
  EXPENSE_REVERSAL: "Expense reversed",
  SALES_RETURN: "Sales return",
  PURCHASE_RETURN: "Purchase return",
  OPENING_BALANCE: "Opening balance",
  MANUAL: "Journal entry",
};

/** Where a movement's source document lives, when it has a page. */
function sourceHref(row: Movement): string | null {
  if (!row.sourceId) return null;
  if (row.sourceType === "SALES_INVOICE") return DETAIL_ROUTES.sale(row.sourceId);
  if (row.sourceType === "PURCHASE") return DETAIL_ROUTES.purchase(row.sourceId);
  if (row.sourceType === "SALES_RETURN") return DETAIL_ROUTES.salesReturn(row.sourceId);
  if (row.sourceType === "PURCHASE_RETURN") return DETAIL_ROUTES.purchaseReturn(row.sourceId);
  return null;
}

export function CashBankPage() {
  const list = useListState({ limit: 25 });
  const [range, setRange] = React.useState<DateRangeValue>({
    fromDate: startOfMonth(),
    toDate: toInputDate(),
  });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["cash-bank", range.fromDate, range.toDate, list.page],
    queryFn: () =>
      reportsApi.cashBank({
        fromDate: range.fromDate,
        toDate: range.toDate,
        page: list.page,
        limit: list.limit,
      }) as unknown as Promise<CashBankReport>,
  });

  const columns: Column<Movement>[] = [
    { header: "Date", cell: (row) => <span className="whitespace-nowrap">{formatDate(row.date)}</span> },
    {
      header: "What",
      cell: (row) => {
        const href = sourceHref(row);
        const label = SOURCE_LABEL[row.sourceType] ?? row.sourceType;
        return (
          <span className="block min-w-0">
            {href ? (
              <Link href={href} className="font-medium hover:text-primary">
                {label}
              </Link>
            ) : (
              <span className="font-medium">{label}</span>
            )}
            <span className="block max-w-[16rem] truncate text-xs text-muted-foreground">
              {row.description ?? row.journalNumber}
            </span>
          </span>
        );
      },
    },
    { header: "Account", hideOnMobile: true, cell: (row) => <span className="whitespace-nowrap">{row.account.name}</span> },
    {
      header: "Money in",
      numeric: true,
      cell: (row) =>
        Number(row.moneyIn) === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <Money value={row.moneyIn} className="text-success" />
        ),
    },
    {
      header: "Money out",
      numeric: true,
      cell: (row) =>
        Number(row.moneyOut) === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <Money value={row.moneyOut} className="text-destructive" />
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <PageHeader title="Cash & Bank" description="Money in the till and money in the bank, from your books." />
        <MoneyTabs />
      </div>

      <DateRangeFilter
        value={range}
        onChange={(next) => {
          setRange(next);
          list.setPage(1);
        }}
      />

      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
            <StatCard
              label="Opening balance"
              value={<Money value={data?.totals.openingBalance} tone="auto" />}
              hint="Cash + bank at the start"
              icon={Wallet}
              isLoading={isLoading}
            />
            <StatCard
              label="Money in"
              value={<Money value={data?.totals.moneyIn} />}
              hint="In the chosen dates"
              icon={ArrowDownLeft}
              tone="cash"
              isLoading={isLoading}
            />
            <StatCard
              label="Money out"
              value={<Money value={data?.totals.moneyOut} />}
              hint="In the chosen dates"
              icon={ArrowUpRight}
              tone="dues"
              isLoading={isLoading}
            />
            <StatCard
              label="Closing balance"
              value={<Money value={data?.totals.closingBalance} tone="auto" />}
              hint="Cash + bank at the end"
              icon={Landmark}
              tone="cash"
              isLoading={isLoading}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {isLoading
              ? [0, 1].map((key) => <Skeleton key={key} className="h-40 w-full rounded-xl" />)
              : data?.accounts.map((account) => (
                  <Card key={account.code}>
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-sm">
                        {/* 1000 is the system Cash account; everything else here is a bank. */}
                        {account.code === "1000" ? (
                          <Wallet className="h-4 w-4 text-success" />
                        ) : (
                          <Landmark className="h-4 w-4 text-primary" />
                        )}
                        {account.name}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1.5 text-sm">
                      <Line label="Opening" value={account.openingBalance} />
                      <Line label="Money in" value={account.moneyIn} className="text-success" />
                      <Line label="Money out" value={account.moneyOut} className="text-destructive" />
                      <div className="border-t pt-1.5">
                        <Line label="Closing" value={account.closingBalance} strong />
                      </div>
                    </CardContent>
                  </Card>
                ))}
          </div>

          <div className="space-y-2">
            <h2 className="text-sm font-semibold">Transactions</h2>
            <DataTable
              columns={columns}
              rows={data?.movements}
              rowKey={(row) => `${row.journalNumber}-${row.account.code}-${row.moneyIn}-${row.moneyOut}`}
              isLoading={isLoading}
              mobileCard={(row) => {
                const href = sourceHref(row);
                const body = (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{SOURCE_LABEL[row.sourceType] ?? row.sourceType}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {formatDate(row.date)} · {row.account.name}
                      </p>
                      {row.description ? (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.description}</p>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right text-sm font-semibold">
                      {Number(row.moneyIn) !== 0 ? <Money value={row.moneyIn} className="block text-success" /> : null}
                      {Number(row.moneyOut) !== 0 ? (
                        <Money value={row.moneyOut} className="block text-destructive" />
                      ) : null}
                    </div>
                  </div>
                );
                return href ? <Link href={href}>{body}</Link> : body;
              }}
              pagination={
                data?.pagination
                  ? {
                      page: data.pagination.page,
                      totalPages: data.pagination.totalPages,
                      total: data.pagination.total,
                      onPageChange: list.setPage,
                    }
                  : undefined
              }
              emptyTitle="No money moved in these dates"
              emptyDescription="Try a wider date range, or record a sale, a receipt or an expense."
            />
          </div>

          {/* The backend's note is written for an accountant; say it plainly here. */}
          {data ? (
            <p className="text-xs text-muted-foreground">
              Every completed sale, purchase, payment and expense paid in cash or by bank shows up here by itself.
            </p>
          ) : null}
        </>
      )}

      <NotAvailable
        features={[
          {
            title: "Separate bank accounts",
            description: "Receipts, payments and expenses always go to the one main Bank account. Choosing which bank a payment used is not supported yet.",
          },
          {
            title: "Move money between cash and bank",
            description: "Depositing cash into the bank, or withdrawing it, cannot be recorded yet.",
          },
          {
            title: "Other income",
            description: "Money that is not from a sale (interest, rent received) has no entry screen yet.",
          },
        ]}
      />
    </div>
  );
}

function Line({
  label,
  value,
  className,
  strong,
}: {
  label: string;
  value: string;
  className?: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <Money value={value} tone="auto" className={strong ? "font-bold" : className} />
    </div>
  );
}
