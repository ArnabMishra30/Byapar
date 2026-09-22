"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, BookOpen, Clock, Truck, UserCheck } from "lucide-react";
import { creditApi } from "@/lib/api";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { ErrorState, LoadingState, EmptyState } from "@/components/shared/states";
import { Money } from "@/components/shared/money";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/utils";

/**
 * The credit book - "udhaar".
 *
 * Two questions, one screen: who owes me, and whom do I owe. Everything is read
 * from the backend's collection and payables summaries, which age each bill by
 * how many days past its DUE date it is - not by how old the bill is.
 *
 * Deliberately not laid out like accounting software: the biggest number a
 * shopkeeper cares about is at the top, and the chase list is right below it.
 */

interface PartyRow {
  partyId: string;
  name: string;
  outstanding: string;
  overdue: string;
  documentCount: number;
  overdueCount: number;
  oldestDueDate: string | null;
  daysPastDue: number | null;
  overdueBucket: string;
}

interface Bucket {
  bucket: string;
  amount: string;
  documentCount: number;
}

interface Summary {
  asOf: string;
  outstanding: {
    total: string;
    overdue: string;
    notYetDue: string;
    undated: string;
    invoiceCount?: number;
    billCount?: number;
    customerCount?: number;
    supplierCount?: number;
  };
  dueSoon?: { total: string; invoiceCount: number; toDate: string };
  collected?: { today: { total: string; receiptCount: number } };
  paid?: { today: { total: string; paymentCount: number } };
  ageing: Bucket[];
  topOverdueCustomers?: PartyRow[];
  topOverdueSuppliers?: PartyRow[];
}

const BUCKET_LABEL: Record<string, string> = {
  NOT_DUE: "Not due yet",
  "1-30": "1–30 days late",
  "31-60": "31–60 days late",
  "61-90": "61–90 days late",
  "90+": "Over 90 days late",
  UNDATED: "No due date agreed",
};

function AgeingTable({ buckets }: { buckets: Bucket[] }) {
  return (
    <div className="rounded-xl border bg-card">
      <div className="w-full overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>How late</TableHead>
              <TableHead className="text-right">Bills</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {buckets.map((bucket) => (
              <TableRow key={bucket.bucket}>
                <TableCell>
                  <span className="font-medium">{BUCKET_LABEL[bucket.bucket] ?? bucket.bucket}</span>
                </TableCell>
                <TableCell className="text-right tabular">{bucket.documentCount}</TableCell>
                <TableCell className="text-right font-medium tabular">
                  <Money value={bucket.amount} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function ChaseList({
  rows,
  hrefBase,
  emptyText,
}: {
  rows: PartyRow[];
  hrefBase: string;
  emptyText: string;
}) {
  if (rows.length === 0) {
    return <EmptyState title="Nothing overdue" description={emptyText} icon={Clock} />;
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <Link
          key={row.partyId}
          href={`${hrefBase}/${row.partyId}`}
          className="flex items-center gap-3 rounded-xl border bg-card p-3 transition-colors hover:border-primary/40"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-foreground">{row.name}</span>
            <span className="block text-xs text-muted-foreground">
              {row.overdueCount} bill(s) late
              {row.daysPastDue !== null ? ` · oldest ${row.daysPastDue} days` : ""}
              {row.oldestDueDate ? ` · due ${formatDate(row.oldestDueDate)}` : ""}
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className="block font-bold text-foreground">
              <Money value={row.overdue} />
            </span>
            <span className="block text-xs text-muted-foreground">
              of <Money value={row.outstanding} />
            </span>
          </span>
        </Link>
      ))}
    </div>
  );
}

export function CreditPage() {
  const today = new Date().toISOString().slice(0, 10);

  const receivables = useQuery({
    queryKey: ["credit", "collections", today],
    queryFn: () => creditApi.collections({ asOfDate: today }) as unknown as Promise<Summary>,
  });

  const payables = useQuery({
    queryKey: ["credit", "payables-summary", today],
    queryFn: () => creditApi.payablesSummary({ asOfDate: today }) as unknown as Promise<Summary>,
  });

  const isLoading = receivables.isLoading || payables.isLoading;
  const error = receivables.error || payables.error;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Credit book"
        description="Who owes you money, and whom you owe."
      />

      {error ? (
        <ErrorState
          error={error}
          onRetry={() => {
            receivables.refetch();
            payables.refetch();
          }}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
            <StatCard
              label="Customers owe you"
              value={<Money value={receivables.data?.outstanding.total} />}
              hint={`${receivables.data?.outstanding.customerCount ?? 0} customer(s)`}
              icon={UserCheck}
              tone="credit"
              isLoading={isLoading}
            />
            <StatCard
              label="Of that, overdue"
              value={<Money value={receivables.data?.outstanding.overdue} />}
              hint="Past the agreed date"
              icon={AlertTriangle}
              tone="dues"
              isLoading={isLoading}
            />
            <StatCard
              label="You owe suppliers"
              value={<Money value={payables.data?.outstanding.total} />}
              hint={`${payables.data?.outstanding.supplierCount ?? 0} supplier(s)`}
              icon={Truck}
              tone="dues"
              isLoading={isLoading}
            />
            <StatCard
              label="Collected today"
              value={<Money value={receivables.data?.collected?.today.total} />}
              hint={`${receivables.data?.collected?.today.receiptCount ?? 0} receipt(s)`}
              icon={ArrowDownLeft}
              tone="cash"
              isLoading={isLoading}
            />
          </div>

          {receivables.data?.dueSoon ? (
            <Card>
              <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">
                    Falling due in the next 7 days ({receivables.data.dueSoon.invoiceCount} bill(s))
                  </span>
                </div>
                <span className="text-lg font-bold">
                  <Money value={receivables.data.dueSoon.total} />
                </span>
              </CardContent>
            </Card>
          ) : null}

          {isLoading ? (
            <LoadingState rows={4} />
          ) : (
            <Tabs defaultValue="owed-to-me">
              <TabsList>
                <TabsTrigger value="owed-to-me" className="gap-1.5">
                  <ArrowDownLeft className="h-4 w-4" />
                  Owed to you
                </TabsTrigger>
                <TabsTrigger value="i-owe" className="gap-1.5">
                  <ArrowUpRight className="h-4 w-4" />
                  You owe
                </TabsTrigger>
              </TabsList>

              <TabsContent value="owed-to-me" className="space-y-6">
                <section className="space-y-3">
                  <h2 className="text-sm font-semibold">Chase these first</h2>
                  <ChaseList
                    rows={receivables.data?.topOverdueCustomers ?? []}
                    hrefBase="/shop/customers"
                    emptyText="Nobody is past their due date. "
                  />
                </section>

                <section className="space-y-3">
                  <h2 className="text-sm font-semibold">How old the money is</h2>
                  <AgeingTable buckets={receivables.data?.ageing ?? []} />
                  <p className="text-xs text-muted-foreground">
                    A bill with no agreed due date is outstanding, but never counted as late.
                  </p>
                </section>
              </TabsContent>

              <TabsContent value="i-owe" className="space-y-6">
                <section className="space-y-3">
                  <h2 className="text-sm font-semibold">Pay these first</h2>
                  <ChaseList
                    rows={payables.data?.topOverdueSuppliers ?? []}
                    hrefBase="/shop/suppliers"
                    emptyText="Nothing is past its due date."
                  />
                </section>

                <section className="space-y-3">
                  <h2 className="text-sm font-semibold">How old the dues are</h2>
                  <AgeingTable buckets={payables.data?.ageing ?? []} />
                </section>
              </TabsContent>
            </Tabs>
          )}
        </>
      )}
    </div>
  );
}
