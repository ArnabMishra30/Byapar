"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, ChevronRight, Loader2, MapPin, Phone, Receipt, Store, X } from "lucide-react";
import { publicShareApi, type SharedAccount, type SharedInvoice } from "@/lib/api/share";
import { Money } from "@/components/shared/money";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn, formatDate, formatDateTime } from "@/lib/utils";

/**
 * What a customer (or supplier) sees when they open a link the shop sent.
 *
 * READ-ONLY and NO LOGIN. Every figure comes straight from the server, which
 * reads the shop's own ledgers; this page adds nothing up. Written for a phone:
 * the person opening it is usually tapping a WhatsApp message.
 */
export function SharedPage({ token }: { token: string }) {
  const query = useQuery({
    queryKey: ["shared", token],
    queryFn: () => publicShareApi.view(token),
    retry: false,
    staleTime: Infinity,
  });
  const [openInvoiceId, setOpenInvoiceId] = React.useState<string | null>(null);

  if (query.isLoading) {
    return (
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-6">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-64 w-full" />
      </main>
    );
  }

  if (query.error || !query.data) {
    return (
      <main className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <Receipt className="h-6 w-6" />
        </span>
        <h1 className="text-lg font-semibold">This link is no longer available</h1>
        <p className="text-sm text-muted-foreground">
          The shop may have stopped sharing it. Please ask them to send you a new link.
        </p>
      </main>
    );
  }

  const { shop, invoice, account, generatedAt } = query.data;

  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      {/* Who sent it */}
      <header className="flex items-start gap-3 rounded-xl border bg-card p-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Store className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold">{shop.name}</h1>
          {shop.legalName && shop.legalName !== shop.name ? (
            <p className="truncate text-xs text-muted-foreground">{shop.legalName}</p>
          ) : null}
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {shop.city ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {shop.city}
              </span>
            ) : null}
            {shop.phone ? (
              <a href={`tel:${shop.phone}`} className="inline-flex items-center gap-1 text-primary">
                <Phone className="h-3 w-3" />
                {shop.phone}
              </a>
            ) : null}
            {shop.gstin ? <span>GSTIN {shop.gstin}</span> : null}
          </div>
        </div>
      </header>

      {invoice ? <InvoiceCard invoice={invoice} /> : null}
      {account ? <AccountCard account={account} shopName={shop.name} onOpenInvoice={setOpenInvoiceId} /> : null}

      <p className="pb-6 text-center text-xs text-muted-foreground">
        A read-only copy shared by {shop.name}. Updated {formatDateTime(generatedAt)}.
        <br />
        For any question, please contact the shop.
      </p>

      <InvoiceDialog token={token} invoiceId={openInvoiceId} onClose={() => setOpenInvoiceId(null)} />
    </main>
  );
}

function StatusChip({ status, due }: { status: string; due: string | null }) {
  if (status === "CANCELLED") return <Badge variant="destructive">Cancelled</Badge>;
  if (due != null && Number(due) <= 0) return <Badge variant="success">Paid</Badge>;
  return <Badge variant="warning">Payment due</Badge>;
}

function InvoiceCard({ invoice, flat = false }: { invoice: SharedInvoice; flat?: boolean }) {
  const body = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Bill to</p>
          <p className="font-medium">{invoice.customerName}</p>
          {invoice.customerGstin ? <p className="text-xs text-muted-foreground">GSTIN {invoice.customerGstin}</p> : null}
        </div>
        <div className="text-right text-sm">
          <p>
            <span className="text-muted-foreground">Date </span>
            {formatDate(invoice.invoiceDate)}
          </p>
          {invoice.dueDate ? (
            <p>
              <span className="text-muted-foreground">Due </span>
              {formatDate(invoice.dueDate)}
            </p>
          ) : null}
        </div>
      </div>

      <ul className="divide-y rounded-lg border">
        {invoice.items.map((item) => (
          <li key={item.lineNumber} className="flex items-start justify-between gap-3 p-3 text-sm">
            <div className="min-w-0">
              <p className="break-words font-medium">{item.name}</p>
              <p className="text-xs text-muted-foreground">
                {Number(item.quantity)} {item.unit ?? ""} × <Money value={item.unitPrice} />
                {Number(item.discount) > 0 ? (
                  <>
                    {" "}
                    · less <Money value={item.discount} />
                  </>
                ) : null}
                {item.taxRate && Number(item.taxRate) > 0 ? ` · GST ${Number(item.taxRate)}%` : null}
              </p>
              {item.contains && item.contains.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  Contains: {item.contains.map((c) => `${Number(c.quantity)} × ${c.name}`).join(", ")}
                </p>
              ) : null}
            </div>
            {item.isFree ? (
              <span className="shrink-0 text-sm font-semibold text-success">FREE</span>
            ) : (
              <Money value={item.total} className="shrink-0 font-medium" />
            )}
          </li>
        ))}
      </ul>

      <dl className="space-y-1 text-sm">
        <Row label="Subtotal" value={invoice.subtotal} />
        {Number(invoice.discountTotal) > 0 ? <Row label="Discount" value={invoice.discountTotal} /> : null}
        {Number(invoice.taxTotal) > 0 ? <Row label="Tax" value={invoice.taxTotal} /> : null}
        <Row label="Total" value={invoice.grandTotal} strong />
        {invoice.paid != null && Number(invoice.paid) > 0 ? <Row label="Paid" value={invoice.paid} /> : null}
        {invoice.returned != null && Number(invoice.returned) > 0 ? <Row label="Returned" value={invoice.returned} /> : null}
        {invoice.due != null ? (
          <div className="flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2">
            <dt className="font-semibold">Balance due</dt>
            <dd>
              <Money
                value={invoice.due}
                className={cn("text-lg font-bold", Number(invoice.due) > 0 ? "text-warning" : "text-success")}
              />
            </dd>
          </div>
        ) : null}
      </dl>
      {invoice.notes ? <p className="text-xs text-muted-foreground">{invoice.notes}</p> : null}
    </div>
  );

  if (flat) return body;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Receipt className="h-4 w-4 text-muted-foreground" />
          Invoice {invoice.invoiceNumber ?? ""}
        </CardTitle>
        <StatusChip status={invoice.status} due={invoice.due} />
      </CardHeader>
      <CardContent className="pt-0">{body}</CardContent>
    </Card>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between", strong && "border-t pt-1 font-semibold")}>
      <dt className={strong ? "" : "text-muted-foreground"}>{label}</dt>
      <dd>
        <Money value={value} />
      </dd>
    </div>
  );
}

/**
 * The log book. Customer side: a bill raises what they owe, a payment or return
 * lowers it. Supplier side: the mirror - a bill raises what the shop owes them.
 */
function AccountCard({
  account,
  shopName,
  onOpenInvoice,
}: {
  account: SharedAccount;
  shopName: string;
  onOpenInvoice: (id: string) => void;
}) {
  const isCustomer = account.side === "CUSTOMER";
  const balance = Number(account.closingBalance);
  const headline = isCustomer
    ? balance > 0
      ? "You owe"
      : balance < 0
        ? "Your advance with the shop"
        : "All settled"
    : balance > 0
      ? `${shopName} owes you`
      : balance < 0
        ? `Advance paid to you`
        : "All settled";
  const shown = balance < 0 ? account.closingBalance.replace("-", "") : account.closingBalance;

  // Customer: debit = bill, credit = paid/returned. Supplier: the mirror.
  const billOf = (line: SharedAccount["lines"][number]) => (isCustomer ? line.debit : line.credit);
  const paidOf = (line: SharedAccount["lines"][number]) => (isCustomer ? line.credit : line.debit);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <BookOpen className="h-4 w-4 text-muted-foreground" />
          Account of {account.partyName}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <div className="rounded-lg bg-muted/60 p-4 text-center">
          <p className="text-sm text-muted-foreground">{headline}</p>
          {balance !== 0 ? (
            <Money
              value={shown}
              className={cn("text-3xl font-bold", balance > 0 ? "text-warning" : "text-success")}
            />
          ) : null}
        </div>

        {account.lines.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground">No entries yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {account.lines.map((line, index) => {
              const bill = Number(billOf(line));
              const clickable = Boolean(line.invoiceId);
              const content = (
                <>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {line.label}
                      {line.documentNumber ? <span className="text-muted-foreground"> {line.documentNumber}</span> : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(line.date)}
                      {line.reference ? ` · ${line.reference}` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={cn("text-sm font-semibold", bill > 0 ? "" : "text-success")}>
                      {bill > 0 ? "+" : "−"}
                      <Money value={bill > 0 ? billOf(line) : paidOf(line)} />
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Balance <Money value={line.balance} />
                    </p>
                  </div>
                  {clickable ? <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" /> : null}
                </>
              );
              return (
                <li key={`${line.date}-${index}`}>
                  {clickable ? (
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 p-3 text-left hover:bg-muted/50"
                      onClick={() => onOpenInvoice(line.invoiceId!)}
                    >
                      {content}
                    </button>
                  ) : (
                    <div className="flex items-center gap-3 p-3">{content}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function InvoiceDialog({ token, invoiceId, onClose }: { token: string; invoiceId: string | null; onClose: () => void }) {
  const query = useQuery({
    queryKey: ["shared", token, "invoice", invoiceId],
    queryFn: () => publicShareApi.invoice(token, invoiceId!),
    enabled: Boolean(invoiceId),
    retry: false,
  });

  return (
    <Dialog open={invoiceId !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Invoice {query.data?.invoiceNumber ?? ""}</DialogTitle>
          <DialogDescription>A read-only copy.</DialogDescription>
        </DialogHeader>
        {query.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : query.data ? (
          <InvoiceCard invoice={query.data} flat />
        ) : (
          <p className="text-sm text-muted-foreground">This invoice could not be opened.</p>
        )}
        <Button variant="outline" onClick={onClose} className="min-h-[44px] gap-1.5">
          <X className="h-4 w-4" />
          Close
        </Button>
      </DialogContent>
    </Dialog>
  );
}
