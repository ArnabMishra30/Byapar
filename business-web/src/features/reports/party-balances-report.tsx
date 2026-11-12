"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { HandCoins, Scale, Search, Users, Wallet } from "lucide-react";
import { DETAIL_ROUTES, ROUTES } from "@/lib/constants";
import { toInputDate, formatDate, cn } from "@/lib/utils";
import { DataTable, type Column } from "@/components/shared/data-table";
import { StatCard } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ReportNote, ReportSection, ReportShell, StatGrid } from "./report-shell";
import { reportCalls } from "./api";

/**
 * The one party report: every party, side by side, with what they owe you and
 * what you owe them.
 *
 * There are no "customers" and "suppliers" here - one party can be both. Each
 * side's balance is the backend's own figure (receivable from the customer
 * sub-ledger, payable from the supplier one); they are shown together but NEVER
 * netted away. "Net" is a view figure only - a plain difference of the two
 * balances, so the shop can see, per party, who is ahead.
 */

interface Row {
  partyId: string;
  name: string;
  phone: string | null;
  /** They owe you (receivable). */
  receivable: string;
  /** You owe them (payable). */
  payable: string;
  /** receivable - payable, a display figure. Positive: they owe you. */
  net: string;
}

// Difference of two exact balances, in integer paise so there is no float
// drift. A view figure; each side's balance stays the backend's.
function netOf(receivable: string, payable: string): string {
  const paise = Math.round(Number(receivable) * 100) - Math.round(Number(payable) * 100);
  return (paise / 100).toFixed(2);
}

export function PartyBalancesReport() {
  const router = useRouter();
  const [asOfDate, setAsOfDate] = React.useState(() => toInputDate());
  const [search, setSearch] = React.useState("");

  // Receivables and payables are two reads: the customer sub-ledger and the
  // supplier one. They are merged here by party, not by the backend, because
  // the two sub-ledgers are deliberately kept apart.
  const receivables = useQuery({
    queryKey: ["report", "party-balances", "receivable", asOfDate],
    queryFn: () => reportCalls.customerOutstanding({ asOfDate: asOfDate || undefined, overdueOnly: false }),
  });
  const payables = useQuery({
    queryKey: ["report", "party-balances", "payable", asOfDate],
    queryFn: () => reportCalls.supplierOutstanding({ asOfDate: asOfDate || undefined, overdueOnly: false }),
  });

  const isLoading = receivables.isLoading || payables.isLoading;
  const error = receivables.error ?? payables.error;

  const rows = React.useMemo<Row[]>(() => {
    const byId = new Map<string, Row>();
    for (const c of receivables.data?.customers ?? []) {
      byId.set(c.partyId, {
        partyId: c.partyId,
        name: c.name,
        phone: c.phone,
        receivable: c.outstanding,
        payable: "0",
        net: netOf(c.outstanding, "0"),
      });
    }
    for (const s of payables.data?.suppliers ?? []) {
      const existing = byId.get(s.partyId);
      if (existing) {
        existing.payable = s.outstanding;
        existing.net = netOf(existing.receivable, s.outstanding);
      } else {
        byId.set(s.partyId, {
          partyId: s.partyId,
          name: s.name,
          phone: s.phone,
          receivable: "0",
          payable: s.outstanding,
          net: netOf("0", s.outstanding),
        });
      }
    }
    const list = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
    const q = search.trim().toLowerCase();
    return q ? list.filter((r) => r.name.toLowerCase().includes(q) || (r.phone ?? "").includes(q)) : list;
  }, [receivables.data, payables.data, search]);

  const owesYouTotal = receivables.data?.summary.total;
  const youOweTotal = payables.data?.summary.total;
  const netTotal = owesYouTotal != null && youOweTotal != null ? netOf(owesYouTotal, youOweTotal) : undefined;

  const columns: Column<Row>[] = [
    {
      header: "Party",
      cell: (row) => (
        <span className="block">
          <span className="block font-medium">{row.name}</span>
          {row.phone ? <span className="block text-xs text-muted-foreground">{row.phone}</span> : null}
        </span>
      ),
    },
    {
      header: "Owes you",
      numeric: true,
      cell: (row) =>
        Number(row.receivable) > 0 ? (
          <Money value={row.receivable} className="font-semibold text-success" />
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      header: "You owe",
      numeric: true,
      cell: (row) =>
        Number(row.payable) > 0 ? (
          <Money value={row.payable} className="font-semibold text-destructive" />
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      header: "Net",
      numeric: true,
      cell: (row) => {
        const n = Number(row.net);
        return (
          <Money
            value={row.net}
            className={cn("font-semibold", n < 0 ? "text-destructive" : n > 0 ? "text-success" : "text-muted-foreground")}
          />
        );
      },
    },
    {
      header: "Action",
      cell: (row) => (
        <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
          {Number(row.receivable) > 0 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`${ROUTES.moneyReceived}?customerId=${row.partyId}`}>Receive</Link>
            </Button>
          ) : null}
          {Number(row.payable) > 0 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`${ROUTES.moneyPaid}?supplierId=${row.partyId}`}>Pay</Link>
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <ReportShell
      title="Party report"
      description="Every party, what they owe you and what you owe them."
      filters={
        <>
          <label className="flex h-10 w-full items-center gap-2 rounded-lg border border-input bg-background px-3 sm:w-auto">
            <span className="shrink-0 text-xs font-medium text-muted-foreground">As of</span>
            <Input
              type="date"
              aria-label="As of date"
              className="h-auto min-w-0 flex-1 border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
              value={asOfDate}
              max={toInputDate()}
              onChange={(e) => setAsOfDate(e.target.value)}
            />
          </label>
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search a party…"
              className="h-10 pl-9"
              aria-label="Search parties"
            />
          </div>
        </>
      }
    >
      <StatGrid>
        <StatCard
          label="Owes you"
          icon={Wallet}
          tone="credit"
          isLoading={isLoading}
          value={<Money value={owesYouTotal} />}
          hint={receivables.data ? `As of ${formatDate(receivables.data.asOf)}` : undefined}
        />
        <StatCard
          label="You owe"
          icon={HandCoins}
          tone="dues"
          isLoading={isLoading}
          value={<Money value={youOweTotal} />}
        />
        <StatCard label="Net position" icon={Scale} isLoading={isLoading} value={<Money value={netTotal} />} />
        <StatCard
          label="Parties with dues"
          icon={Users}
          isLoading={isLoading}
          value={isLoading ? "—" : rows.length}
        />
      </StatGrid>

      <ReportSection title="Parties" contentClassName="px-3 sm:px-6">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.partyId}
          isLoading={isLoading}
          error={error}
          onRetry={() => {
            receivables.refetch();
            payables.refetch();
          }}
          onRowClick={(row) => router.push(DETAIL_ROUTES.partyStatement(row.partyId))}
          mobileCard={(row) => (
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 truncate font-medium">{row.name}</p>
                <Money
                  value={row.net}
                  className={cn("shrink-0 font-semibold", Number(row.net) < 0 && "text-destructive")}
                />
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {Number(row.receivable) > 0 ? (
                  <span>
                    Owes you <Money value={row.receivable} className="font-medium text-success" />
                  </span>
                ) : null}
                {Number(row.payable) > 0 ? (
                  <span>
                    You owe <Money value={row.payable} className="font-medium text-destructive" />
                  </span>
                ) : null}
              </div>
              <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                {Number(row.receivable) > 0 ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={`${ROUTES.moneyReceived}?customerId=${row.partyId}`}>Receive</Link>
                  </Button>
                ) : null}
                {Number(row.payable) > 0 ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={`${ROUTES.moneyPaid}?supplierId=${row.partyId}`}>Pay</Link>
                  </Button>
                ) : null}
              </div>
            </div>
          )}
          emptyTitle="No dues either way"
          emptyDescription="Parties with an open balance — owed to you or by you — appear here."
        />
        <div className="mt-3">
          <ReportNote>
            Each side is the backend&apos;s own figure from its sub-ledger; they are shown together but never
            netted in the books. &ldquo;Net&rdquo; is a view figure: owes you − you owe.
          </ReportNote>
        </div>
      </ReportSection>
    </ReportShell>
  );
}
