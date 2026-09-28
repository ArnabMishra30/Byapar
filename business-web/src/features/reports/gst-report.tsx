"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, Scale, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ROUTES } from "@/lib/constants";
import { DataTable, type Column } from "@/components/shared/data-table";
import { StatCard } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ReportNote, ReportSection, ReportShell, StatGrid, rangeParams, useReportRange } from "./report-shell";
import { AmountLine } from "./report-parts";
import { reportCalls, type TaxTotals } from "./api";

/**
 * GST reports: tax collected on sales against tax paid on purchases, and the
 * figures an accountant copies into GSTR-1 and GSTR-3B.
 *
 * PREPARED, NOT FILED. The backend builds every figure from posted documents
 * and says so on each response; that caveat is shown, never dropped.
 */

type TaxRow = TaxTotals & { key: string; label: string };

const taxColumns: Column<TaxRow>[] = [
  { header: "", cell: (row) => <span className="font-medium">{row.label}</span> },
  { header: "Taxable value", numeric: true, cell: (row) => <Money value={row.taxableAmount} /> },
  { header: "CGST", numeric: true, hideOnMobile: true, cell: (row) => <Money value={row.cgst} /> },
  { header: "SGST", numeric: true, hideOnMobile: true, cell: (row) => <Money value={row.sgst} /> },
  { header: "IGST", numeric: true, hideOnMobile: true, cell: (row) => <Money value={row.igst} /> },
  { header: "Cess", numeric: true, hideOnMobile: true, cell: (row) => <Money value={row.cess} /> },
  { header: "Total tax", numeric: true, cell: (row) => <Money value={row.totalTax} className="font-semibold" /> },
];

function TaxTable({ rows, emptyTitle }: { rows: TaxRow[]; emptyTitle: string }) {
  return (
    <DataTable
      columns={taxColumns}
      rows={rows}
      rowKey={(row) => row.key}
      mobileCard={(row) => (
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 truncate font-medium">{row.label}</p>
            <Money value={row.totalTax} className="shrink-0 font-semibold" />
          </div>
          <p className="text-xs text-muted-foreground">
            Taxable <Money value={row.taxableAmount} /> · CGST <Money value={row.cgst} /> · SGST{" "}
            <Money value={row.sgst} /> · IGST <Money value={row.igst} />
          </p>
        </div>
      )}
      emptyTitle={emptyTitle}
    />
  );
}

function Prepared({ text }: { text?: string }) {
  return (
    <div className="rounded-lg border border-warning/25 bg-warning/5 p-3 text-xs leading-relaxed text-muted-foreground">
      {text ??
        "Prepared from your posted bills. Nothing has been filed with the GST portal — use these figures when you or your accountant file."}
    </div>
  );
}

export function GstReport() {
  const { isGstEnabled, isReady } = useAuth();
  const [range, setRange] = useReportRange();
  const params = rangeParams(range);
  const hasFullPeriod = Boolean(params.fromDate && params.toDate);
  const period = hasFullPeriod ? { fromDate: params.fromDate!, toDate: params.toDate! } : null;

  const summary = useQuery({
    queryKey: ["report", "gst-summary", params],
    queryFn: () => reportCalls.gstSummary(params),
    enabled: isGstEnabled,
  });
  const gstr1 = useQuery({
    queryKey: ["report", "gstr1", period],
    queryFn: () => reportCalls.gstr1(period!),
    enabled: isGstEnabled && Boolean(period),
  });
  const gstr3b = useQuery({
    queryKey: ["report", "gstr3b", period],
    queryFn: () => reportCalls.gstr3b(period!),
    enabled: isGstEnabled && Boolean(period),
  });
  const hsnSales = useQuery({
    queryKey: ["report", "hsn", "SALES_INVOICE", params],
    queryFn: () => reportCalls.hsnSummary("SALES_INVOICE", params),
    enabled: isGstEnabled,
  });
  const hsnPurchases = useQuery({
    queryKey: ["report", "hsn", "PURCHASE", params],
    queryFn: () => reportCalls.hsnSummary("PURCHASE", params),
    enabled: isGstEnabled,
  });

  if (isReady && !isGstEnabled) {
    return (
      <ReportShell title="GST report" description="Tax collected and tax paid.">
        <EmptyState
          icon={ShieldCheck}
          title="GST is not switched on"
          description="Your business is not set up for GST, so there are no tax figures. Everything else in Byapar works without it. If you register for GST, the shop owner can switch it on."
          action={
            <Button asChild variant="outline">
              <Link href={ROUTES.gstRegistration}>GST registration</Link>
            </Button>
          }
        />
      </ReportShell>
    );
  }

  const s = summary.data;
  const netCredit = s?.net.position === "CREDIT";

  const needPeriod = (
    <EmptyState
      title="Choose a start and end date"
      description="A GST return is always for a stated period. Pick “This month” or set both dates above."
    />
  );

  return (
    <ReportShell
      title="GST report"
      description="Tax collected on sales, tax paid on purchases, and your return figures."
      range={range}
      onRangeChange={setRange}
    >
      <StatGrid>
        <StatCard
          label="GST collected on sales"
          icon={ArrowDownLeft}
          isLoading={summary.isLoading}
          value={<Money value={s?.outputTax.totalTax} />}
        />
        <StatCard
          label="GST paid on purchases"
          icon={ArrowUpRight}
          isLoading={summary.isLoading}
          value={<Money value={s?.inputTax.totalTax} />}
          hint="Input tax credit"
        />
        <StatCard
          label={netCredit ? "Extra credit carried" : "GST to pay"}
          icon={Scale}
          tone={netCredit ? "cash" : "dues"}
          isLoading={summary.isLoading}
          value={<Money value={s?.net.netTax} tone="auto" />}
          hint="Collected less paid"
        />
      </StatGrid>

      <Tabs defaultValue="summary" className="space-y-4">
        <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0" data-print-hide>
          <TabsList>
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="gstr1">GSTR-1</TabsTrigger>
            <TabsTrigger value="gstr3b">GSTR-3B</TabsTrigger>
            <TabsTrigger value="hsn">HSN summary</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="summary" className="space-y-4">
          {summary.error ? (
            <ErrorState error={summary.error} onRetry={() => summary.refetch()} />
          ) : summary.isLoading || !s ? (
            <LoadingState rows={3} />
          ) : (
            <>
              <ReportSection title="Collected vs paid" contentClassName="px-3 sm:px-6">
                <TaxTable
                  emptyTitle="No GST in this period"
                  rows={[
                    { key: "out", label: "On sales (output)", ...s.outputTax },
                    { key: "in", label: "On purchases (input)", ...s.inputTax },
                  ]}
                />
              </ReportSection>
              <ReportSection title="By tax rate, on sales" contentClassName="px-3 sm:px-6">
                <TaxTable
                  emptyTitle="No sales with GST in this period"
                  rows={s.outputTax.byRate.map((row) => ({ key: row.taxRate, label: `${row.taxRate}%`, ...row }))}
                />
              </ReportSection>
              <Prepared text={s.note} />
            </>
          )}
        </TabsContent>

        <TabsContent value="gstr1" className="space-y-4">
          {!period ? (
            needPeriod
          ) : gstr1.error ? (
            <ErrorState error={gstr1.error} onRetry={() => gstr1.refetch()} />
          ) : gstr1.isLoading || !gstr1.data ? (
            <LoadingState rows={3} />
          ) : (
            <>
              <ReportSection
                title="Outward supplies"
                description={`${gstr1.data.totals.invoiceCount} invoices, ${gstr1.data.totals.creditNoteCount} credit notes`}
                contentClassName="px-3 sm:px-6"
              >
                <TaxTable
                  emptyTitle="No sales in this period"
                  rows={[
                    { key: "b2b", label: "To GST-registered buyers (B2B)", ...gstr1.data.b2b.totals },
                    { key: "b2c", label: "To other buyers (B2C)", ...gstr1.data.b2c.totals },
                    { key: "cn", label: "Credit notes (returns)", ...gstr1.data.creditNotes.totals },
                    { key: "nil", label: "Nil-rated / exempt", ...gstr1.data.nilRatedExemptZeroRated.totals },
                    { key: "net", label: "Net of credit notes", ...gstr1.data.totals.net },
                  ]}
                />
              </ReportSection>
              <ReportSection title="HSN-wise (table 12)" contentClassName="px-3 sm:px-6">
                <TaxTable
                  emptyTitle="No HSN lines in this period"
                  rows={gstr1.data.hsnSummary.rows.map((row, index) => ({
                    key: `${row.hsn ?? "none"}-${row.taxRate ?? ""}-${index}`,
                    label: `${row.hsn ?? "No HSN"}${row.taxRate ? ` · ${row.taxRate}%` : ""}`,
                    ...row,
                  }))}
                />
              </ReportSection>
              {gstr1.data.documentsIssued?.rows?.length ? (
                <ReportSection title="Documents issued (table 13)">
                  {gstr1.data.documentsIssued.rows.map((row) => (
                    <div key={row.documentType} className="flex flex-wrap items-center justify-between gap-2 border-b py-2.5 text-sm last:border-0">
                      <span className="font-medium">{row.documentType}</span>
                      <span className="text-muted-foreground">
                        {row.from ?? "—"} to {row.to ?? "—"} · {row.totalIssued} issued, {row.cancelled} cancelled
                      </span>
                    </div>
                  ))}
                </ReportSection>
              ) : null}
              <Prepared text={gstr1.data.notFiled} />
            </>
          )}
        </TabsContent>

        <TabsContent value="gstr3b" className="space-y-4">
          {!period ? (
            needPeriod
          ) : gstr3b.error ? (
            <ErrorState error={gstr3b.error} onRetry={() => gstr3b.refetch()} />
          ) : gstr3b.isLoading || !gstr3b.data ? (
            <LoadingState rows={3} />
          ) : (
            <>
              <ReportSection title="Key figures">
                <AmountLine
                  label="Tax on outward supplies (3.1)"
                  hint={gstr3b.data.outwardSupplies.taxableSupplies.label}
                  value={gstr3b.data.outwardSupplies.totals.totalTax}
                />
                <AmountLine
                  label="Net input tax credit (4C)"
                  hint={gstr3b.data.inputTaxCredit.netItcAvailable.label}
                  value={gstr3b.data.inputTaxCredit.netItcAvailable.totalTax}
                />
                <AmountLine
                  label={gstr3b.data.netPosition.position === "CREDIT" ? "Credit carried forward" : "Net tax to pay"}
                  hint={gstr3b.data.netPosition.description}
                  value={gstr3b.data.netPosition.totalTax}
                  strong
                />
              </ReportSection>
              <ReportSection title="Detail" contentClassName="px-3 sm:px-6">
                <TaxTable
                  emptyTitle="Nothing in this period"
                  rows={[
                    { ...gstr3b.data.outwardSupplies.taxableSupplies, key: "a", label: "3.1(a) Taxable outward supplies" },
                    { ...gstr3b.data.outwardSupplies.nilRatedExemptSupplies, key: "c", label: "3.1(c) Nil-rated / exempt" },
                    { ...gstr3b.data.inputTaxCredit.allOtherItc, key: "itc", label: "4(A)(5) All other ITC" },
                    { ...gstr3b.data.inputTaxCredit.itcReversed, key: "rev", label: "4(B)(2) ITC reversed" },
                    { ...gstr3b.data.inputTaxCredit.netItcAvailable, key: "net", label: "4(C) Net ITC" },
                  ]}
                />
              </ReportSection>
              {gstr3b.data.unclassified && gstr3b.data.unclassified.documentCount > 0 ? (
                <ReportNote>
                  {gstr3b.data.unclassified.documentCount} documents are left out: {gstr3b.data.unclassified.description}
                </ReportNote>
              ) : null}
              <Prepared text={gstr3b.data.notFiled} />
            </>
          )}
        </TabsContent>

        <TabsContent value="hsn" className="space-y-4">
          {[
            { title: "Sales by HSN", query: hsnSales },
            { title: "Purchases by HSN", query: hsnPurchases },
          ].map(({ title, query }) => (
            <ReportSection key={title} title={title} contentClassName="px-3 sm:px-6">
              {query.error ? (
                <ErrorState error={query.error} onRetry={() => query.refetch()} />
              ) : query.isLoading || !query.data ? (
                <LoadingState rows={2} />
              ) : (
                <TaxTable
                  emptyTitle="No lines in this period"
                  rows={query.data.rows.map((row, index) => ({
                    key: `${row.hsn ?? "none"}-${index}`,
                    label: row.hsn ?? "No HSN code",
                    ...row,
                  }))}
                />
              )}
            </ReportSection>
          ))}
          <Prepared text={hsnSales.data?.note} />
        </TabsContent>
      </Tabs>
    </ReportShell>
  );
}
