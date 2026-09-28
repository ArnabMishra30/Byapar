"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Eye, Plus, Printer } from "lucide-react";
import { dueListsApi } from "@/lib/api";
import type { Receivable, SalesInvoice } from "@/types/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PaidDue } from "@/components/shared/paid-due";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/shared/status-badge";
import { DETAIL_ROUTES, ROUTES } from "@/lib/constants";

/**
 * The end of a counter sale: what was recorded, and what is still owed.
 *
 * "Paid" and "Due" are re-read from the receivable the backend keeps for this
 * invoice, after any payment was posted - never worked out from what was typed.
 * If a step failed, it says which one and where to finish it, because an
 * invoice that posted with a payment that did not is the one mistake a
 * shopkeeper must not be left to discover later.
 */

export type PaymentOutcome =
  | { status: "none" }
  | { status: "done" }
  /** The payment was never created. */
  | { status: "failed"; message: string }
  /** The payment exists as a draft but could not be posted. */
  | { status: "unposted"; message: string };

export function BillResult({
  invoice,
  customerId,
  payment,
  onNewBill,
}: {
  invoice: SalesInvoice;
  customerId: string;
  payment: PaymentOutcome;
  onNewBill: () => void;
}) {
  const receivable = useQuery({
    queryKey: ["quick-billing", "receivable", invoice.id],
    queryFn: async () => {
      const { items } = await dueListsApi.receivables<Receivable>({
        customerId,
        invoiceNumber: invoice.invoiceNumber,
        limit: 10,
      });
      return items.find((row) => row.salesInvoice?.id === invoice.id) ?? null;
    },
  });

  const moneyReceivedHref = `${ROUTES.moneyReceived}?customerId=${customerId}`;

  return (
    <Card className="border-success/30">
      <CardContent className="space-y-5 p-4 sm:p-6">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-7 w-7 shrink-0 text-success" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-lg font-bold">Sale completed</p>
            <p className="truncate text-sm text-muted-foreground">
              {invoice.invoiceNumber} · {invoice.customer?.name}
            </p>
          </div>
          <StatusBadge status={invoice.status} />
        </div>

        {receivable.isLoading ? (
          <Skeleton className="h-14 w-full" />
        ) : receivable.data ? (
          <PaidDue
            size="lg"
            total={invoice.grandTotal}
            paid={receivable.data.paidAmount}
            due={receivable.data.outstandingAmount}
          />
        ) : (
          // The invoice total is known; paid/due could not be read, so they are
          // not shown rather than guessed.
          <div className="space-y-2">
            <PaidDue size="lg" total={invoice.grandTotal} />
            <p className="text-xs text-muted-foreground">
              Could not load what is paid and due right now.{" "}
              <button type="button" className="underline" onClick={() => receivable.refetch()}>
                Try again
              </button>
            </p>
          </div>
        )}

        {payment.status === "failed" ? (
          <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
            <p>
              The sale is recorded, but <strong>the payment was not</strong>: {payment.message}{" "}
              <Link href={moneyReceivedHref} className="font-medium underline">
                Record it in Money Received
              </Link>
              .
            </p>
          </div>
        ) : null}

        {payment.status === "unposted" ? (
          <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
            <p>
              The sale is recorded and the payment was saved as a <strong>draft</strong>, but it
              could not be posted: {payment.message}{" "}
              <Link href={moneyReceivedHref} className="font-medium underline">
                Finish it in Money Received
              </Link>
              .
            </p>
          </div>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-3">
          <Button asChild variant="outline" className="h-11">
            <Link href={DETAIL_ROUTES.sale(invoice.id)}>
              <Eye className="h-4 w-4" />
              View invoice
            </Link>
          </Button>
          <Button asChild variant="outline" className="h-11">
            <Link href={DETAIL_ROUTES.sale(invoice.id)}>
              <Printer className="h-4 w-4" />
              Print
            </Link>
          </Button>
          <Button className="h-11" onClick={onNewBill}>
            <Plus className="h-4 w-4" />
            New bill
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
