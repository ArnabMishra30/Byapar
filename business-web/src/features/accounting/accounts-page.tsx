"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { accountingApi } from "@/lib/api";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, useListState, type Column } from "@/components/shared/data-table";
import { Money } from "@/components/shared/money";
import { Badge } from "@/components/ui/badge";

/**
 * The chart of accounts.
 *
 * Deliberately plain: most shopkeepers never open this screen, and the ones who
 * do (or their accountant) want the real account codes, not a simplified view.
 * Balances come from the trial balance, which is the ledger's own answer.
 */
const TYPE_LABEL: Record<string, string> = {
  ASSET: "Things you own",
  LIABILITY: "What you owe",
  EQUITY: "Owner capital",
  REVENUE: "Income",
  EXPENSE: "Costs",
};

export function AccountsPage() {
  const list = useListState({ limit: 50 });

  const accounts = useQuery({
    queryKey: ["accounts", list.page, list.search],
    queryFn: () =>
      accountingApi.accounts({
        page: list.page,
        limit: list.limit,
        search: list.search || undefined,
      }),
  });

  const trial = useQuery({
    queryKey: ["trial-balance"],
    queryFn: () =>
      accountingApi.trialBalance() as unknown as Promise<{
        isBalanced: boolean;
        accounts: { code: string; balance: string }[];
      }>,
  });

  const balanceByCode = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const row of trial.data?.accounts ?? []) map.set(row.code, row.balance);
    return map;
  }, [trial.data]);

  const columns: Column<Record<string, unknown>>[] = [
    { header: "Code", cell: (row) => <span className="tabular">{String(row.code)}</span> },
    {
      header: "Account",
      cell: (row) => <span className="font-medium">{String(row.name)}</span>,
    },
    {
      header: "Kind",
      hideOnMobile: true,
      cell: (row) => (
        <Badge variant="outline">{TYPE_LABEL[String(row.type)] ?? String(row.type)}</Badge>
      ),
    },
    {
      header: "Balance",
      numeric: true,
      cell: (row) => {
        const balance = balanceByCode.get(String(row.code));
        return balance ? <Money value={balance} tone="auto" /> : <span className="text-muted-foreground">—</span>;
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Accounts"
        description="The accounts your books are kept in."
        actions={
          trial.data ? (
            <Badge variant={trial.data.isBalanced ? "success" : "destructive"}>
              {trial.data.isBalanced ? "Books balance" : "Books do not balance"}
            </Badge>
          ) : null
        }
      />

      <DataTable
        columns={columns}
        rows={accounts.data?.items}
        rowKey={(row) => String(row.id)}
        isLoading={accounts.isLoading}
        error={accounts.error}
        onRetry={() => accounts.refetch()}
        search={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search accounts…"
        pagination={
          accounts.data?.pagination
            ? {
                page: accounts.data.pagination.page,
                totalPages: accounts.data.pagination.totalPages,
                total: accounts.data.pagination.total,
                onPageChange: list.setPage,
              }
            : undefined
        }
        emptyTitle="No accounts"
        emptyDescription="Every business starts with a standard set of accounts."
      />
    </div>
  );
}
