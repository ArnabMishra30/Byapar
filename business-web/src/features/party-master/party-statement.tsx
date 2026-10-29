"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  ApiError,
  partiesApi,
  type PartyStatement,
  type StatementLine,
  type StatementParams,
  type StatementType,
} from "@/lib/api";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, LoadingState, NotFoundState } from "@/components/shared/states";
import { Money } from "@/components/shared/money";
import { PrintActions } from "@/components/shared/print-actions";
import { DateRangeFilter, type DateRangeValue } from "@/components/shared/date-range";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select-native";
import { ROUTES } from "@/lib/constants";
import { formatDate } from "@/lib/utils";

// THE PARTY STATEMENT PAGE.
//
// Every figure here comes straight from the backend statement - this page does
// no money arithmetic of its own. It shows the one merged ledger with two
// running balances (what they owe you, what you owe them), lets the shop filter
// by date, type and reference, and downloads a real PDF or .xlsx built on the
// server from the same data.

const TYPE_OPTIONS: { value: StatementType; label: string }[] = [
  { value: "ALL", label: "All transactions" },
  { value: "SALES", label: "Sales" },
  { value: "PURCHASES", label: "Purchases" },
  { value: "RECEIPTS", label: "Receipts" },
  { value: "PAYMENTS", label: "Payments" },
  { value: "RETURNS", label: "Returns" },
];

const STATUS_LABEL: Record<string, string> = {
  PAID: "Paid",
  PARTIAL: "Partial",
  UNPAID: "Unpaid",
  CREDITED: "Credited",
  UNUSED: "Unused",
  SETTLED: "Settled",
  CANCELLED: "Cancelled",
};

function safeName(name: string | null | undefined) {
  return (name || "party").replace(/[^a-zA-Z0-9 _-]/g, "").trim().replace(/\s+/g, "-") || "party";
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function PartyStatementPage({ id }: { id: string }) {
  const [range, setRange] = React.useState<DateRangeValue>({});
  const [type, setType] = React.useState<StatementType>("ALL");
  const [searchInput, setSearchInput] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [showItems, setShowItems] = React.useState(true);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [downloading, setDownloading] = React.useState<"pdf" | "xlsx" | null>(null);

  const params: StatementParams = {
    fromDate: range.fromDate,
    toDate: range.toDate,
    type,
    search: search || undefined,
    includeItems: showItems,
  };

  const query = useQuery({
    queryKey: ["party-statement", id, params],
    queryFn: () => partiesApi.statement(id, params),
    placeholderData: (prev) => prev,
  });

  const toggle = (documentId: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(documentId)) next.delete(documentId);
      else next.add(documentId);
      return next;
    });

  const download = async (format: "pdf" | "xlsx") => {
    setDownloading(format);
    try {
      const blob = await partiesApi.statementFile(id, format, params);
      downloadBlob(blob, `statement-${safeName(query.data?.party.name)}.${format}`);
    } catch (err) {
      toast.error(`Could not download the ${format.toUpperCase()}`, {
        description: err instanceof ApiError ? err.message : undefined,
      });
    } finally {
      setDownloading(null);
    }
  };

  const back = (
    <Button asChild variant="ghost" size="sm" className="-ml-2 gap-1.5" data-print-hide>
      <Link href={ROUTES.parties}>
        <ArrowLeft className="h-4 w-4" />
        Parties
      </Link>
    </Button>
  );

  if (query.isLoading && !query.data) {
    return (
      <div className="space-y-6">
        {back}
        <LoadingState rows={6} />
      </div>
    );
  }

  if (query.error || !query.data) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div className="space-y-6">
        {back}
        {notFound ? (
          <NotFoundState description="This party does not exist, or belongs to another business." />
        ) : (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        )}
      </div>
    );
  }

  const statement = query.data;
  const { company, party, summary } = statement;

  return (
    <div className="space-y-5">
      {back}

      <PageHeader
        title="Party Statement"
        description={party.name}
        actions={
          <div className="flex flex-wrap items-center gap-2" data-print-hide>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => download("pdf")}
              disabled={downloading !== null}
            >
              {downloading === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              PDF
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => download("xlsx")}
              disabled={downloading !== null}
            >
              {downloading === "xlsx" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
              Excel
            </Button>
            <PrintActions title={`Statement - ${party.name}`} />
          </div>
        }
      />

      {/* Business + party header, kept on the printed page. */}
      <Card>
        <CardContent className="grid grid-cols-1 gap-4 pt-6 sm:grid-cols-2">
          <div className="min-w-0 space-y-0.5">
            <p className="text-base font-semibold">{company.name ?? "—"}</p>
            {company.address ? <p className="text-sm text-muted-foreground">{company.address}</p> : null}
            {company.phone || company.email ? (
              <p className="text-sm text-muted-foreground">{[company.phone, company.email].filter(Boolean).join(" · ")}</p>
            ) : null}
            {company.gstin ? (
              <p className="text-xs text-muted-foreground">
                GSTIN: {company.gstin}
                {company.stateCode ? `  ·  State: ${company.stateCode}${company.stateName ? `-${company.stateName}` : ""}` : ""}
              </p>
            ) : null}
          </div>
          <div className="min-w-0 space-y-0.5 sm:text-right">
            <p className="text-sm font-medium">{party.name}</p>
            {party.phone ? <p className="text-sm text-muted-foreground">{party.phone}</p> : null}
            {party.address ? <p className="text-sm text-muted-foreground">{party.address}</p> : null}
            <p className="text-xs text-muted-foreground">
              {statement.period.fromDate || statement.period.toDate
                ? `${statement.period.fromDate ? formatDate(statement.period.fromDate) : "Start"} — ${statement.period.toDate ? formatDate(statement.period.toDate) : "Today"}`
                : "All transactions"}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Two balances, shown separately and never netted. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <BalanceCard label="They owe you (receivable)" value={summary.closingReceivable} tone="positive" />
        <BalanceCard label="You owe them (payable)" value={summary.closingPayable} tone="negative" />
        <MiniStat label="Total sales" value={summary.totalSales} />
        <MiniStat label="Total purchases" value={summary.totalPurchases} />
      </div>

      {/* Controls. */}
      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end" data-print-hide>
        <DateRangeFilter value={range} onChange={setRange} />
        <div className="min-w-0">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Type</label>
          <NativeSelect value={type} onChange={(e) => setType(e.target.value as StatementType)} className="w-full sm:w-[160px]">
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <form
          className="min-w-0 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(searchInput.trim());
          }}
        >
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Search reference</label>
          <div className="flex gap-2">
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Invoice / bill / receipt no."
              className="min-w-0"
            />
            <Button type="submit" variant="outline">
              Search
            </Button>
          </div>
        </form>
        <label className="flex min-h-[40px] items-center gap-2 text-sm">
          <input type="checkbox" checked={showItems} onChange={(e) => setShowItems(e.target.checked)} className="h-4 w-4" />
          Item details
        </label>
      </div>

      {statement.openingReceivable !== "0.00" || statement.openingPayable !== "0.00" ? (
        <p className="text-sm text-muted-foreground">
          Opening — Receivable <Money value={statement.openingReceivable} />, Payable{" "}
          <Money value={statement.openingPayable} />
        </p>
      ) : null}

      {/* The merged ledger. */}
      <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
        {/* whitespace-nowrap (inherited) keeps the nine columns from wrapping, so
            the table overflows and scrolls on a narrow screen instead of
            squashing - no fixed pixel width needed. */}
        <table className="w-full border-collapse whitespace-nowrap text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 pr-2 font-medium">Date</th>
              <th className="py-2 pr-2 font-medium">Type</th>
              <th className="py-2 pr-2 font-medium">Ref No.</th>
              <th className="py-2 pr-2 font-medium">Status</th>
              <th className="py-2 pr-2 text-right font-medium">Total</th>
              <th className="py-2 pr-2 text-right font-medium">Received / Paid</th>
              <th
                className="py-2 pr-2 text-right font-medium"
                title="The transaction's own amount when it posted — not changed by later payments"
              >
                Txn Balance
              </th>
              <th
                className="py-2 pr-2 text-right font-medium"
                title="Running total of what the party owes you, in date order"
              >
                Receivable Balance
              </th>
              <th
                className="py-2 text-right font-medium"
                title="Running total of what you owe the party, in date order"
              >
                Payable Balance
              </th>
            </tr>
          </thead>
          <tbody>
            {statement.lines.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-muted-foreground">
                  No transactions for the selected filters.
                </td>
              </tr>
            ) : (
              statement.lines.map((line) => (
                <LedgerRow
                  key={`${line.referenceType}:${line.documentId}`}
                  line={line}
                  expandable={showItems && Boolean(line.document?.items?.length)}
                  expanded={expanded.has(line.documentId)}
                  onToggle={() => toggle(line.documentId)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">{statement.basis}</p>
    </div>
  );
}

function BalanceCard({ label, value, tone }: { label: string; value: string; tone: "positive" | "negative" }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-bold">
          <Money value={value} className={tone === "positive" ? "text-success" : "text-warning"} />
        </p>
      </CardContent>
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-lg font-semibold">
          <Money value={value} />
        </p>
      </CardContent>
    </Card>
  );
}

function LedgerRow({
  line,
  expandable,
  expanded,
  onToggle,
}: {
  line: StatementLine;
  expandable: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const items = line.document?.items ?? [];
  return (
    <>
      <tr className="border-b align-top">
        <td className="py-2 pr-2 whitespace-nowrap">{line.date ? formatDate(line.date) : "—"}</td>
        <td className="py-2 pr-2">
          {expandable ? (
            <button type="button" onClick={onToggle} className="inline-flex items-center gap-1 hover:text-primary" data-print-hide>
              <ChevronRight className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-90" : ""}`} />
              {line.label}
            </button>
          ) : (
            line.label
          )}
        </td>
        <td className="py-2 pr-2">{line.documentNumber ?? "—"}</td>
        <td className="py-2 pr-2">
          {line.paymentStatus ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
              {STATUS_LABEL[line.paymentStatus] ?? line.paymentStatus}
            </span>
          ) : (
            "—"
          )}
        </td>
        <td className="py-2 pr-2 text-right tabular">
          <Money value={line.total} />
        </td>
        <td className="py-2 pr-2 text-right tabular">
          {Number(line.receivedPaid) ? <Money value={line.receivedPaid} /> : "—"}
        </td>
        <td className="py-2 pr-2 text-right tabular">
          <Money value={line.txnBalance} />
        </td>
        <td className="py-2 pr-2 text-right tabular">
          <Money value={line.receivableBalance} />
        </td>
        <td className="py-2 text-right tabular">
          <Money value={line.payableBalance} />
        </td>
      </tr>
      {line.payment ? (
        <tr className="border-b bg-muted/20">
          <td colSpan={9} className="px-3 py-1.5 text-xs text-muted-foreground">
            <span className="font-medium">Payment mode:</span> {line.payment.modeLabel ?? "Not specified"}
            {line.payment.reference ? (
              <>
                {"  ·  "}
                <span className="font-medium">Ref:</span> {line.payment.reference}
              </>
            ) : null}
            {Number(line.payment.allocated) > 0 ? (
              <>
                {"  ·  "}Allocated <Money value={line.payment.allocated} />
              </>
            ) : null}
            {Number(line.payment.unallocated) > 0 ? (
              <>
                {"  ·  "}Unused advance <Money value={line.payment.unallocated} />
              </>
            ) : null}
            {line.payment.notes ? (
              <>
                {"  ·  "}
                <span className="font-medium">Notes:</span> {line.payment.notes}
              </>
            ) : null}
          </td>
        </tr>
      ) : null}
      {expandable && expanded && items.length > 0 ? (
        <tr className="border-b bg-muted/30">
          <td colSpan={9} className="px-3 py-2">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 pr-2 font-medium">#</th>
                  <th className="py-1 pr-2 font-medium">Item</th>
                  <th className="py-1 pr-2 font-medium">HSN/SAC</th>
                  <th className="py-1 pr-2 text-right font-medium">Qty</th>
                  <th className="py-1 pr-2 text-right font-medium">Price/unit</th>
                  <th className="py-1 pr-2 text-right font-medium">Discount</th>
                  <th className="py-1 pr-2 text-right font-medium">Tax</th>
                  <th className="py-1 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.sno}>
                    <td className="py-1 pr-2">{it.sno}</td>
                    <td className="py-1 pr-2 whitespace-normal">{it.name}</td>
                    <td className="py-1 pr-2">{it.hsn ?? "—"}</td>
                    <td className="py-1 pr-2 text-right tabular">
                      {it.quantity}
                      {it.unit ? ` ${it.unit}` : ""}
                    </td>
                    <td className="py-1 pr-2 text-right tabular">
                      <Money value={it.unitPrice} />
                    </td>
                    <td className="py-1 pr-2 text-right tabular">
                      {it.discount && Number(it.discount) ? <Money value={it.discount} /> : "—"}
                    </td>
                    <td className="py-1 pr-2 text-right tabular">
                      {it.tax && Number(it.tax) ? <Money value={it.tax} /> : "—"}
                    </td>
                    <td className="py-1 text-right tabular">
                      <Money value={it.amount} />
                    </td>
                  </tr>
                ))}
                <tr className="border-t font-medium">
                  <td colSpan={7} className="py-1 pr-2 text-right">
                    Total
                  </td>
                  <td className="py-1 text-right tabular">
                    <Money value={line.document?.total ?? line.total} />
                  </td>
                </tr>
              </tbody>
            </table>
            {line.currentOutstanding != null && Number(line.currentOutstanding) !== Number(line.total) ? (
              <p className="mt-1 text-xs italic text-muted-foreground">
                Outstanding now on this {line.kind === "PURCHASE" ? "bill" : "invoice"}:{" "}
                <Money value={line.currentOutstanding} /> (as of today, after later payments)
              </p>
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}
