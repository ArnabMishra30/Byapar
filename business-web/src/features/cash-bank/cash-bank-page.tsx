"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, Landmark, Wallet } from "lucide-react";
import { reportsApi } from "@/lib/api";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { ErrorState, LoadingState, EmptyState } from "@/components/shared/states";
import { Money } from "@/components/shared/money";
import { DateRangeFilter, type DateRangeValue } from "@/components/shared/date-range";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, startOfMonth } from "@/lib/utils";

/**
 * Cash and bank.
 *
 * Every figure is the general ledger's own answer: the balance is what the books
 * say, and each movement names the bill or receipt behind it. Nothing is added
 * up in the browser.
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
  moneyIn: string;
  moneyOut: string;
}

interface CashBankReport {
  accounts: CashAccount[];
  movements: Movement[];
  totals: { moneyIn: string; moneyOut: string; netMovement: string; closingBalance: string };
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
};

export function CashBankPage() {
  const [range, setRange] = React.useState<DateRangeValue>({
    fromDate: startOfMonth(),
    toDate: new Date().toISOString().slice(0, 10),
  });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["cash-bank", range.fromDate, range.toDate],
    queryFn: () =>
      reportsApi.cashBank({ ...range, limit: 100 }) as unknown as Promise<CashBankReport>,
  });

  const cash = data?.accounts.find((a) => a.code === "1000");
  const banks = data?.accounts.filter((a) => a.code !== "1000") ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title="Cash & bank" description="Money in the till and money in the bank." />

      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
            <StatCard
              label="Cash in hand"
              value={<Money value={cash?.closingBalance} tone="auto" />}
              icon={Wallet}
              tone="cash"
              isLoading={isLoading}
            />
            {banks.slice(0, 1).map((bank) => (
              <StatCard
                key={bank.code}
                label={bank.name}
                value={<Money value={bank.closingBalance} tone="auto" />}
                icon={Landmark}
                tone="cash"
                isLoading={isLoading}
              />
            ))}
            <StatCard
              label="Money in"
              value={<Money value={data?.totals.moneyIn} />}
              hint="In the chosen dates"
              icon={ArrowDownLeft}
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
          </div>

          {banks.length > 1 ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {banks.map((bank) => (
                <StatCard
                  key={bank.code}
                  label={bank.name}
                  value={<Money value={bank.closingBalance} tone="auto" />}
                  hint={`Account ${bank.code}`}
                  icon={Landmark}
                  tone="cash"
                  isLoading={isLoading}
                />
              ))}
            </div>
          ) : null}

          <DateRangeFilter value={range} onChange={setRange} />

          {isLoading ? (
            <LoadingState rows={4} />
          ) : !data || data.movements.length === 0 ? (
            <EmptyState
              title="No money moved in these dates"
              description="Try a wider date range, or record a sale, a receipt or an expense."
            />
          ) : (
            <div className="rounded-xl border bg-card">
              <div className="w-full overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>What</TableHead>
                      <TableHead className="hidden sm:table-cell">Account</TableHead>
                      <TableHead className="text-right">In</TableHead>
                      <TableHead className="text-right">Out</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.movements.map((row, index) => (
                      <TableRow key={`${row.journalNumber}-${index}`}>
                        <TableCell className="whitespace-nowrap">{formatDate(row.date)}</TableCell>
                        <TableCell>
                          <span className="block font-medium">
                            {SOURCE_LABEL[row.sourceType] ?? row.sourceType}
                          </span>
                          <span className="block max-w-[14rem] truncate text-xs text-muted-foreground">
                            {row.description ?? row.journalNumber}
                          </span>
                        </TableCell>
                        <TableCell className="hidden whitespace-nowrap sm:table-cell">
                          {row.account.name}
                        </TableCell>
                        <TableCell className="text-right tabular">
                          {row.moneyIn === "0.00" ? "—" : <Money value={row.moneyIn} />}
                        </TableCell>
                        <TableCell className="text-right tabular">
                          {row.moneyOut === "0.00" ? "—" : <Money value={row.moneyOut} />}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {data?.note ? <p className="text-xs text-muted-foreground">{data.note}</p> : null}
        </>
      )}
    </div>
  );
}
