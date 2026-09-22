"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { accountingApi, reportsApi } from "@/lib/api";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, useListState, type Column } from "@/components/shared/data-table";
import { DateRangeFilter, type DateRangeValue } from "@/components/shared/date-range";
import { Money } from "@/components/shared/money";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate, startOfMonth } from "@/lib/utils";

/**
 * The journal and the ledger.
 *
 * Every posted document writes exactly one balanced journal entry, and this is
 * where they can be seen. The source type on each entry says which document
 * caused it, so anything here traces back to a real bill or receipt.
 */
const SOURCE_LABEL: Record<string, string> = {
  SALES_INVOICE: "Sale",
  SALES_RETURN: "Sales return",
  PURCHASE: "Purchase",
  PURCHASE_RETURN: "Purchase return",
  CUSTOMER_PAYMENT: "Money received",
  SUPPLIER_PAYMENT: "Money paid",
  EXPENSE: "Expense",
  EXPENSE_REVERSAL: "Expense reversed",
  OPENING_BALANCE: "Opening balance",
  REVERSAL: "Correction",
};

export function JournalPage() {
  const journalList = useListState({ limit: 20 });
  const ledgerList = useListState({ limit: 50 });
  const [range, setRange] = React.useState<DateRangeValue>({
    fromDate: startOfMonth(),
    toDate: new Date().toISOString().slice(0, 10),
  });

  const journal = useQuery({
    queryKey: ["journal", journalList.page, range.fromDate, range.toDate],
    queryFn: () =>
      accountingApi.journal({
        page: journalList.page,
        limit: journalList.limit,
        dateFrom: range.fromDate,
        dateTo: range.toDate,
      }),
  });

  const ledger = useQuery({
    queryKey: ["general-ledger", ledgerList.page, range.fromDate, range.toDate],
    queryFn: () =>
      reportsApi.generalLedger({
        page: ledgerList.page,
        limit: ledgerList.limit,
        fromDate: range.fromDate,
        toDate: range.toDate,
      }),
  });

  const journalColumns: Column<Record<string, unknown>>[] = [
    { header: "Number", cell: (row) => <span className="font-medium">{String(row.journalNumber)}</span> },
    {
      header: "Date",
      cell: (row) => <span className="whitespace-nowrap">{formatDate(String(row.entryDate))}</span>,
    },
    {
      header: "Because of",
      cell: (row) => SOURCE_LABEL[String(row.sourceType)] ?? String(row.sourceType),
    },
    {
      header: "Description",
      hideOnMobile: true,
      cell: (row) => (
        <span className="block max-w-[16rem] truncate text-muted-foreground">
          {String(row.description ?? "—")}
        </span>
      ),
    },
    { header: "Amount", numeric: true, cell: (row) => <Money value={String(row.totalDebit ?? "0")} /> },
  ];

  const ledgerColumns: Column<Record<string, unknown>>[] = [
    {
      header: "Date",
      cell: (row) => <span className="whitespace-nowrap">{formatDate(String(row.date))}</span>,
    },
    {
      header: "Account",
      cell: (row) => {
        const account = row.account as { code?: string; name?: string } | undefined;
        return (
          <span className="block">
            <span className="block font-medium">{account?.name}</span>
            <span className="block text-xs text-muted-foreground">{account?.code}</span>
          </span>
        );
      },
    },
    {
      header: "Description",
      hideOnMobile: true,
      cell: (row) => (
        <span className="block max-w-[14rem] truncate text-muted-foreground">
          {String(row.description ?? "—")}
        </span>
      ),
    },
    {
      header: "Debit",
      numeric: true,
      cell: (row) => (row.debit === "0.00" ? "—" : <Money value={String(row.debit)} />),
    },
    {
      header: "Credit",
      numeric: true,
      cell: (row) => (row.credit === "0.00" ? "—" : <Money value={String(row.credit)} />),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Journal & ledger"
        description="The double-entry record behind every document."
      />

      <DateRangeFilter value={range} onChange={setRange} />

      <Tabs defaultValue="journal">
        <TabsList>
          <TabsTrigger value="journal">Journal</TabsTrigger>
          <TabsTrigger value="ledger">Ledger</TabsTrigger>
        </TabsList>

        <TabsContent value="journal">
          <DataTable
            columns={journalColumns}
            rows={journal.data?.items}
            rowKey={(row) => String(row.id)}
            isLoading={journal.isLoading}
            error={journal.error}
            onRetry={() => journal.refetch()}
            mobileCard={(row) => (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {SOURCE_LABEL[String(row.sourceType)] ?? String(row.sourceType)}
              </p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {formatDate(String(row.entryDate))} · {String(row.journalNumber)}
              </p>
            </div>
            <Money value={String(row.totalDebit ?? "0")} className="shrink-0 text-sm font-semibold" />
          </div>
        )}
        pagination={
              journal.data?.pagination
                ? {
                    page: journal.data.pagination.page,
                    totalPages: journal.data.pagination.totalPages,
                    total: journal.data.pagination.total,
                    onPageChange: journalList.setPage,
                  }
                : undefined
            }
            emptyTitle="No entries in these dates"
            emptyDescription="An entry is written every time you post a bill, receipt or expense."
          />
        </TabsContent>

        <TabsContent value="ledger">
          <DataTable
            columns={ledgerColumns}
            rows={ledger.data?.items}
            rowKey={(row) => String(row.id)}
            isLoading={ledger.isLoading}
            error={ledger.error}
            onRetry={() => ledger.refetch()}
            pagination={
              ledger.data?.pagination
                ? {
                    page: ledger.data.pagination.page,
                    totalPages: ledger.data.pagination.totalPages,
                    total: ledger.data.pagination.total,
                    onPageChange: ledgerList.setPage,
                  }
                : undefined
            }
            emptyTitle="No ledger lines in these dates"
            emptyDescription="Try a wider date range."
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
