"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  creditBookApi,
  customersApi,
  moneyInApi,
  moneyOutApi,
  registersApi,
  suppliersApi,
  type PurchaseRegisterRow,
  type SalesRegisterRow,
  type ListResult,
} from "@/lib/api";
import { DataTable, useListState, type Column } from "@/components/shared/data-table";
import { DateRangeFilter, type DateRangeValue } from "@/components/shared/date-range";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/states";
import { Money } from "@/components/shared/money";
import { PaidDue } from "@/components/shared/paid-due";
import { PrintActions } from "@/components/shared/print-actions";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DETAIL_ROUTES } from "@/lib/constants";
import { formatDate } from "@/lib/utils";
import type { CustomerPayment, Payable, Receivable } from "@/types/api";
import type { PartyKind } from "./party-credit";

/**
 * The tabs on a customer or supplier page. Each one is its own backend read;
 * none of them adds up money. Paid and Due on every row are the ledger's own
 * per-invoice figures.
 */

// --- small helpers -----------------------------------------------------------

/**
 * Whole days a due date is behind today, or null when it is not yet due.
 * Date arithmetic only - both dates are business dates at UTC midnight.
 */
export function daysOverdue(dueDate?: string | null, today: Date = new Date()): number | null {
  if (!dueDate) return null;
  const due = Date.parse(`${dueDate.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(due)) return null;
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const days = Math.floor((now - due) / 86_400_000);
  return days > 0 ? days : null;
}

export function OverdueBadge({ dueDate }: { dueDate?: string | null }) {
  const days = daysOverdue(dueDate);
  if (days === null) return dueDate ? <Badge variant="outline">Not yet due</Badge> : null;
  return <Badge variant="destructive">{days} day{days === 1 ? "" : "s"} late</Badge>;
}

const pageOf = (pagination?: { page: number; totalPages: number; total: number }, onPageChange?: (p: number) => void) =>
  pagination && onPageChange
    ? { page: pagination.page, totalPages: pagination.totalPages, total: pagination.total, onPageChange }
    : undefined;

// --- sales / purchase history --------------------------------------------------

export function HistoryTab({ kind, id }: { kind: PartyKind; id: string }) {
  const list = useListState({ limit: 20 });
  const [range, setRange] = React.useState<DateRangeValue>({});

  const sales = useQuery({
    queryKey: ["customer", id, "sales", list.page, range.fromDate, range.toDate],
    queryFn: () => registersApi.sales({ customerId: id, page: list.page, limit: list.limit, ...range }),
    enabled: kind === "customer",
  });
  const purchases = useQuery({
    queryKey: ["supplier", id, "purchases", list.page, range.fromDate, range.toDate],
    queryFn: () => registersApi.purchases({ supplierId: id, page: list.page, limit: list.limit, ...range }),
    enabled: kind === "supplier",
  });

  const filters = (
    <DateRangeFilter
      value={range}
      onChange={(next) => {
        setRange(next);
        list.setPage(1);
      }}
    />
  );

  if (kind === "customer") {
    const columns: Column<SalesRegisterRow>[] = [
      {
        header: "Invoice",
        cell: (row) => (
          <Link href={DETAIL_ROUTES.sale(row.id)} className="font-medium hover:text-primary">
            {row.invoiceNumber}
          </Link>
        ),
      },
      { header: "Date", cell: (row) => <span className="whitespace-nowrap">{formatDate(row.invoiceDate)}</span> },
      { header: "Amount", numeric: true, cell: (row) => <Money value={row.total} /> },
      { header: "Received", numeric: true, hideOnMobile: true, cell: (row) => <Money value={row.paid} /> },
      { header: "Pending", numeric: true, cell: (row) => <Money value={row.outstanding} /> },
      { header: "Status", hideOnMobile: true, cell: (row) => <StatusBadge status={row.paymentStatus} /> },
    ];
    return (
      <div className="space-y-3">
        <DataTable
          columns={columns}
          rows={sales.data?.invoices}
          rowKey={(row) => row.id}
          isLoading={sales.isLoading}
          error={sales.error}
          onRetry={() => sales.refetch()}
          filters={filters}
          mobileCard={(row) => (
            <Link href={DETAIL_ROUTES.sale(row.id)} className="block space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{row.invoiceNumber}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(row.invoiceDate)}</p>
                </div>
                <StatusBadge status={row.paymentStatus} />
              </div>
              <PaidDue total={row.total} paid={row.paid} due={row.outstanding} />
            </Link>
          )}
          pagination={pageOf(sales.data?.pagination, list.setPage)}
          emptyTitle="No sales yet"
          emptyDescription="Posted sales to this customer will show here, with what is paid and what is pending."
        />
        <p className="text-xs text-muted-foreground">Posted invoices only. Drafts are on the Sales page.</p>
      </div>
    );
  }

  const columns: Column<PurchaseRegisterRow>[] = [
    {
      header: "Bill",
      cell: (row) => (
        <Link href={DETAIL_ROUTES.purchase(row.id)} className="font-medium hover:text-primary">
          {row.purchaseNumber}
          {row.supplierInvoiceNumber ? (
            <span className="block text-xs font-normal text-muted-foreground">Their no. {row.supplierInvoiceNumber}</span>
          ) : null}
        </Link>
      ),
    },
    { header: "Date", cell: (row) => <span className="whitespace-nowrap">{formatDate(row.invoiceDate)}</span> },
    { header: "Amount", numeric: true, cell: (row) => <Money value={row.total} /> },
    { header: "Paid", numeric: true, hideOnMobile: true, cell: (row) => <Money value={row.paid} /> },
    { header: "To pay", numeric: true, cell: (row) => <Money value={row.outstanding} /> },
    { header: "Status", hideOnMobile: true, cell: (row) => <StatusBadge status={row.paymentStatus} /> },
  ];
  return (
    <div className="space-y-3">
      <DataTable
        columns={columns}
        rows={purchases.data?.bills}
        rowKey={(row) => row.id}
        isLoading={purchases.isLoading}
        error={purchases.error}
        onRetry={() => purchases.refetch()}
        filters={filters}
        mobileCard={(row) => (
          <Link href={DETAIL_ROUTES.purchase(row.id)} className="block space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{row.purchaseNumber}</p>
                <p className="text-xs text-muted-foreground">{formatDate(row.invoiceDate)}</p>
              </div>
              <StatusBadge status={row.paymentStatus} />
            </div>
            <PaidDue total={row.total} paid={row.paid} due={row.outstanding} />
          </Link>
        )}
        pagination={pageOf(purchases.data?.pagination, list.setPage)}
        emptyTitle="No purchases yet"
        emptyDescription="Posted bills from this supplier will show here, with what is paid and what you still owe."
      />
      <p className="text-xs text-muted-foreground">Posted bills only. Drafts are on the Purchases page.</p>
    </div>
  );
}

// --- payments ----------------------------------------------------------------------

const METHOD_LABEL: Record<string, string> = {
  CASH: "Cash",
  BANK: "Bank",
  BANK_TRANSFER: "Bank transfer",
  UPI: "UPI",
  CHEQUE: "Cheque",
  OTHER: "Other",
};

export function PaymentsTab({ kind, id }: { kind: PartyKind; id: string }) {
  const list = useListState({ limit: 20 });
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["money", kind === "customer" ? "in" : "out", "party", id, list.page],
    // Both sides share one row shape; only the party key differs.
    queryFn: (): Promise<ListResult<CustomerPayment>> =>
      kind === "customer"
        ? moneyInApi.list({ customerId: id, page: list.page, limit: list.limit })
        : (moneyOutApi.list({ supplierId: id, page: list.page, limit: list.limit }) as unknown as Promise<
            ListResult<CustomerPayment>
          >),
  });

  const columns: Column<CustomerPayment>[] = [
    { header: "Number", cell: (row) => <span className="font-medium">{row.paymentNumber}</span> },
    { header: "Date", cell: (row) => <span className="whitespace-nowrap">{formatDate(row.paymentDate)}</span> },
    { header: "How", hideOnMobile: true, cell: (row) => METHOD_LABEL[row.paymentMethod] ?? row.paymentMethod },
    { header: "Amount", numeric: true, cell: (row) => <Money value={row.amount} /> },
    {
      header: "Advance",
      numeric: true,
      hideOnMobile: true,
      cell: (row) =>
        Number(row.unallocatedAmount) === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <Money value={row.unallocatedAmount} />
        ),
    },
    { header: "Status", cell: (row) => <StatusBadge status={row.status} /> },
  ];

  return (
    <DataTable
      columns={columns}
      rows={data?.items}
      rowKey={(row) => row.id}
      isLoading={isLoading}
      error={error}
      onRetry={() => refetch()}
      mobileCard={(row) => (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{row.paymentNumber}</p>
            <p className="text-xs text-muted-foreground">
              {formatDate(row.paymentDate)} · {METHOD_LABEL[row.paymentMethod] ?? row.paymentMethod}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Money value={row.amount} className="text-sm font-semibold" />
            <StatusBadge status={row.status} />
          </div>
        </div>
      )}
      pagination={pageOf(data?.pagination, list.setPage)}
      emptyTitle={kind === "customer" ? "No money received yet" : "No payments made yet"}
      emptyDescription={
        kind === "customer"
          ? "When this customer pays you, record it and it will show here."
          : "When you pay this supplier, record it and it will show here."
      }
    />
  );
}

// --- credit book (open bills) ------------------------------------------------------

type OpenBill = Receivable & Payable & { creditAmount?: string };

export function CreditTab({ kind, id }: { kind: PartyKind; id: string }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["credit", kind, id],
    queryFn: async () => {
      const result = (kind === "customer"
        ? await creditBookApi.customer(id)
        : await creditBookApi.supplier(id)) as { openInvoices?: OpenBill[]; openBills?: OpenBill[] };
      return (kind === "customer" ? result.openInvoices : result.openBills) ?? [];
    },
  });

  const number = (bill: OpenBill) =>
    kind === "customer"
      ? bill.salesInvoice?.invoiceNumber ?? "Opening balance"
      : bill.purchase?.purchaseNumber ?? "Opening balance";
  const href = (bill: OpenBill) =>
    kind === "customer"
      ? bill.salesInvoice
        ? DETAIL_ROUTES.sale(bill.salesInvoice.id)
        : null
      : bill.purchase
        ? DETAIL_ROUTES.purchase(bill.purchase.id)
        : null;

  const columns: Column<OpenBill>[] = [
    {
      header: kind === "customer" ? "Invoice" : "Bill",
      cell: (bill) => {
        const link = href(bill);
        return link ? (
          <Link href={link} className="font-medium hover:text-primary">
            {number(bill)}
          </Link>
        ) : (
          <span className="font-medium">{number(bill)}</span>
        );
      },
    },
    { header: "Amount", numeric: true, hideOnMobile: true, cell: (bill) => <Money value={bill.originalAmount} /> },
    { header: kind === "customer" ? "Received" : "Paid", numeric: true, hideOnMobile: true, cell: (bill) => <Money value={bill.paidAmount} /> },
    { header: kind === "customer" ? "Pending" : "To pay", numeric: true, cell: (bill) => <Money value={bill.outstandingAmount} className="font-semibold" /> },
    { header: "Due date", cell: (bill) => <span className="whitespace-nowrap">{bill.dueDate ? formatDate(bill.dueDate) : "—"}</span> },
    { header: "", cell: (bill) => <OverdueBadge dueDate={bill.dueDate} /> },
  ];

  return (
    <DataTable
      columns={columns}
      rows={data}
      rowKey={(bill) => bill.id}
      isLoading={isLoading}
      error={error}
      onRetry={() => refetch()}
      mobileCard={(bill) => (
        <div className="space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{number(bill)}</p>
              <p className="text-xs text-muted-foreground">Due {bill.dueDate ? formatDate(bill.dueDate) : "—"}</p>
            </div>
            <OverdueBadge dueDate={bill.dueDate} />
          </div>
          <PaidDue total={bill.originalAmount} paid={bill.paidAmount} due={bill.outstandingAmount} />
        </div>
      )}
      emptyTitle="Nothing pending"
      emptyDescription={
        kind === "customer" ? "This customer has no unpaid invoices." : "You have no unpaid bills from this supplier."
      }
    />
  );
}

// --- statement -----------------------------------------------------------------------

interface StatementLine {
  date: string;
  label: string;
  documentNumber: string | null;
  reference?: string | null;
  dueDate?: string | null;
  debit: string;
  credit: string;
  balance: string;
}

interface Statement {
  period?: { label?: string };
  openingBalance: string;
  lines: StatementLine[];
  closingBalance: string;
  totals?: { totalDebit: string; totalCredit: string; entryCount: number };
  balanceMeaning?: string;
}

export function StatementTab({ kind, id, name }: { kind: PartyKind; id: string; name?: string }) {
  const [range, setRange] = React.useState<DateRangeValue>({});
  const api = kind === "customer" ? customersApi : suppliersApi;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [kind, id, "statement", range.fromDate, range.toDate],
    queryFn: () =>
      api.statement(id, { fromDate: range.fromDate, toDate: range.toDate }) as unknown as Promise<Statement>,
  });

  // A customer's debit is a sale (they owe more) and their credit is money
  // received or a return. A supplier is the mirror: credit is a bill, debit is
  // a payment or a return. Column words follow, the figures do not change.
  const debitLabel = kind === "customer" ? "Sale" : "Paid / returned";
  const creditLabel = kind === "customer" ? "Received / returned" : "Bill";

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between" data-print-hide>
        <DateRangeFilter value={range} onChange={setRange} />
        <PrintActions title={name ? `Statement - ${name}` : "Statement"} />
      </div>

      {/* Shown on paper only, so a printed statement says whose it is. */}
      <div className="hidden print:block">
        <p className="text-lg font-bold">Statement of account{name ? ` - ${name}` : ""}</p>
        <p className="text-sm">{data?.period?.label}</p>
      </div>

      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <LoadingState rows={3} />
      ) : !data || data.lines.length === 0 ? (
        <EmptyState
          title="No entries in these dates"
          description={`Posted bills and payments for this ${kind} will appear here.`}
        />
      ) : (
        <>
          {/* Phone: one card per line. */}
          <ul className="divide-y rounded-xl border bg-card sm:hidden print:hidden">
            <li className="flex justify-between p-3 text-sm">
              <span className="text-muted-foreground">Opening balance</span>
              <Money value={data.openingBalance} className="font-medium" />
            </li>
            {data.lines.map((line, index) => (
              <li key={`${line.documentNumber ?? "line"}-${index}`} className="space-y-1 p-3">
                <div className="flex justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate font-medium">{line.label}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatDate(line.date)}</span>
                </div>
                <div className="flex justify-between gap-2 text-xs text-muted-foreground">
                  <span className="truncate">{line.documentNumber ?? "—"}</span>
                  <span className="shrink-0">
                    {Number(line.debit) !== 0 ? (
                      <>
                        {debitLabel} <Money value={line.debit} className="text-foreground" />
                      </>
                    ) : null}
                    {Number(line.credit) !== 0 ? (
                      <>
                        {creditLabel} <Money value={line.credit} className="text-foreground" />
                      </>
                    ) : null}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Balance</span>
                  <Money value={line.balance} className="font-medium" />
                </div>
              </li>
            ))}
            <li className="flex justify-between bg-muted/40 p-3 text-sm">
              <span className="font-semibold">Closing balance</span>
              <Money value={data.closingBalance} tone="auto" className="font-bold" />
            </li>
          </ul>

          <div className="hidden rounded-xl border bg-card sm:block print:block">
            <div className="w-full overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Entry</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead className="text-right">{debitLabel}</TableHead>
                    <TableHead className="text-right">{creditLabel}</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow className="bg-muted/40">
                    <TableCell colSpan={5} className="text-xs font-medium text-muted-foreground">
                      Opening balance
                    </TableCell>
                    <TableCell className="text-right font-medium tabular">
                      <Money value={data.openingBalance} />
                    </TableCell>
                  </TableRow>
                  {data.lines.map((line, index) => (
                    <TableRow key={`${line.documentNumber ?? "line"}-${index}`}>
                      <TableCell className="whitespace-nowrap">{formatDate(line.date)}</TableCell>
                      <TableCell>
                        <span className="block font-medium">{line.label}</span>
                        <span className="block text-xs text-muted-foreground">
                          {line.documentNumber ?? "Opening balance"}
                          {line.reference ? ` · ${line.reference}` : ""}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{line.dueDate ? formatDate(line.dueDate) : "—"}</TableCell>
                      <TableCell className="text-right tabular">
                        {Number(line.debit) === 0 ? "—" : <Money value={line.debit} />}
                      </TableCell>
                      <TableCell className="text-right tabular">
                        {Number(line.credit) === 0 ? "—" : <Money value={line.credit} />}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular">
                        <Money value={line.balance} />
                      </TableCell>
                    </TableRow>
                  ))}
                  {data.totals ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-xs font-medium text-muted-foreground">
                        Totals ({data.totals.entryCount} entries)
                      </TableCell>
                      <TableCell className="text-right tabular">
                        <Money value={data.totals.totalDebit} />
                      </TableCell>
                      <TableCell className="text-right tabular">
                        <Money value={data.totals.totalCredit} />
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  ) : null}
                  <TableRow className="bg-muted/40">
                    <TableCell colSpan={5} className="text-xs font-semibold text-foreground">
                      Closing balance
                    </TableCell>
                    <TableCell className="text-right font-bold tabular">
                      <Money value={data.closingBalance} tone="auto" />
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>

          {data.balanceMeaning ? <p className="text-xs text-muted-foreground">{data.balanceMeaning}</p> : null}
        </>
      )}
    </div>
  );
}
