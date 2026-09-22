"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { platformApi, SubscriptionPayment } from "@/lib/api/platform";
import { PlatformGuard } from "@/features/platform/permission-guard";
import { DataTable, Column } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/utils";
import { Wallet } from "lucide-react";

// COLLECTIONS. The money the platform has taken.
//
// This is the operator's revenue. It has nothing to do with any shop's books,
// and no figure here is derived from one.

export default function PaymentsPage() {
  return (
    <PlatformGuard>
      <PaymentsContent />
    </PlatformGuard>
  );
}

function PaymentsContent() {
  const [page, setPage] = useState(1);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["platform", "payments", page, fromDate, toDate],
    queryFn: () =>
      platformApi.listPayments({
        page,
        limit: 20,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
      }),
  });

  const columns: Column<SubscriptionPayment>[] = [
    {
      header: "Business",
      cell: (payment) => (
        <div>
          <div className="font-medium">{payment.subscription?.company?.name ?? "—"}</div>
          <div className="text-xs text-muted-foreground">
            {payment.subscription?.planNameSnapshot ?? ""}
          </div>
        </div>
      ),
    },
    {
      header: "Amount",
      cell: (payment) => (
        <span className="font-semibold tabular-nums">₹{payment.amount}</span>
      ),
    },
    {
      header: "Method",
      cell: (payment) => <Badge variant="outline">{payment.method}</Badge>,
    },
    {
      header: "Reference",
      cell: (payment) =>
        payment.reference ? (
          <span className="text-sm font-mono">{payment.reference}</span>
        ) : (
          <span className="text-muted-foreground">&mdash;</span>
        ),
    },
    {
      header: "Collected by",
      cell: (payment) => <span className="text-sm">{payment.collectedBy?.name ?? "—"}</span>,
    },
    {
      header: "Date",
      cell: (payment) => (
        <span className="text-sm tabular-nums">{formatDate(payment.paidAt)}</span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight sm:text-2xl">
          <Wallet className="h-5 w-5 shrink-0 text-primary sm:h-6 sm:w-6" />
          Collections
        </h1>
        <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
          Subscription money taken from shops. This is the platform&apos;s revenue.
        </p>
      </div>

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        isError={isError}
        error={error as Error}
        onRetry={refetch}
        mobileCard={(payment) => (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {payment.subscription?.company?.name ?? "—"}
              </p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {formatDate(payment.paidAt)} · {payment.collectedBy?.name ?? "—"}
              </p>
              {payment.reference ? (
                <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                  {payment.reference}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className="text-sm font-semibold tabular-nums">₹{payment.amount}</span>
              <Badge variant="outline">{payment.method}</Badge>
            </div>
          </div>
        )}
        searchable={false}
        filterSlot={
          <div className="grid w-full grid-cols-2 items-end gap-2 sm:flex sm:w-auto">
            <div className="space-y-1">
              <Label htmlFor="fromDate" className="text-xs">
                From
              </Label>
              <Input
                id="fromDate"
                type="date"
                className="w-full sm:w-[150px]"
                value={fromDate}
                onChange={(event) => {
                  setFromDate(event.target.value);
                  setPage(1);
                }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="toDate" className="text-xs">
                To
              </Label>
              <Input
                id="toDate"
                type="date"
                className="w-full sm:w-[150px]"
                value={toDate}
                onChange={(event) => {
                  setToDate(event.target.value);
                  setPage(1);
                }}
              />
            </div>
          </div>
        }
        pagination={
          data?.pagination ? { ...data.pagination, onPageChange: setPage } : undefined
        }
        emptyTitle="No payments recorded"
        emptyDescription="Nothing has been collected in this period."
      />
    </div>
  );
}
