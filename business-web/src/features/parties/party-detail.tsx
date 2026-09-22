"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BookOpen, Phone, Mail, MapPin } from "lucide-react";
import { customersApi, suppliersApi } from "@/lib/api";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, LoadingState, EmptyState } from "@/components/shared/states";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import { DetailRow } from "@/components/shared/form-parts";
import { DateRangeFilter, type DateRangeValue } from "@/components/shared/date-range";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import type { PartyKind } from "./party-list";

/**
 * One customer or supplier: what they owe, every bill and payment, and a
 * statement.
 *
 * The statement is fetched from the backend, which builds it from the
 * sub-ledger and runs the balance itself. Nothing is added up here.
 */

const CONFIG = {
  customer: {
    api: customersApi,
    backHref: "/shop/customers",
    backLabel: "Customers",
    owesLabel: "Owes you",
    statementMeaning: "A positive balance means they owe you.",
  },
  supplier: {
    api: suppliersApi,
    backHref: "/shop/suppliers",
    backLabel: "Suppliers",
    owesLabel: "You owe",
    statementMeaning: "A positive balance means you owe them.",
  },
} as const;

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
  party?: { name: string; creditLimit?: string; isUnlimited?: boolean; creditDays?: number | null };
  openingBalance: string;
  lines: StatementLine[];
  closingBalance: string;
  totals?: { totalDebit: string; totalCredit: string; entryCount: number };
  balanceMeaning?: string;
}

export function PartyDetail({ kind, id }: { kind: PartyKind; id: string }) {
  const config = CONFIG[kind];
  const [range, setRange] = React.useState<DateRangeValue>({});

  const party = useQuery({
    queryKey: [kind, id],
    queryFn: () => config.api.get(id),
  });

  const statement = useQuery({
    queryKey: [kind, id, "statement", range.fromDate, range.toDate],
    queryFn: () =>
      config.api.statement(id, {
        fromDate: range.fromDate,
        toDate: range.toDate,
      }) as unknown as Promise<Statement>,
  });

  if (party.isLoading) {
    return <LoadingState rows={4} />;
  }

  if (party.error) {
    return (
      <div className="space-y-4">
        <Button asChild variant="ghost" size="sm" className="gap-1.5">
          <Link href={config.backHref}>
            <ArrowLeft className="h-4 w-4" />
            {config.backLabel}
          </Link>
        </Button>
        <ErrorState error={party.error} onRetry={() => party.refetch()} />
      </div>
    );
  }

  const record = party.data;
  const closing = statement.data?.closingBalance;

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 gap-1.5">
        <Link href={config.backHref}>
          <ArrowLeft className="h-4 w-4" />
          {config.backLabel}
        </Link>
      </Button>

      <PageHeader
        title={record?.name ?? ""}
        description={record?.phone || record?.email || undefined}
        actions={<StatusBadge status={record?.isActive ? "ACTIVE" : "INACTIVE"} />}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">{config.owesLabel}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {statement.isLoading ? (
                <span className="text-muted-foreground">…</span>
              ) : (
                <Money value={closing} tone="auto" />
              )}
            </p>
            {record?.creditDays !== null && record?.creditDays !== undefined ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Payment terms: {record.creditDays} days
              </p>
            ) : null}
            {record && !record.isUnlimited && record.creditLimit ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Credit limit: <Money value={record.creditLimit} />
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Details</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <DetailRow label="Phone">
              {record?.phone ? (
                <a href={`tel:${record.phone}`} className="inline-flex items-center gap-1.5 hover:text-primary">
                  <Phone className="h-3.5 w-3.5" />
                  {record.phone}
                </a>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </DetailRow>
            <DetailRow label="Email">
              {record?.email ? (
                <a href={`mailto:${record.email}`} className="inline-flex items-center gap-1.5 hover:text-primary">
                  <Mail className="h-3.5 w-3.5" />
                  {record.email}
                </a>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </DetailRow>
            <DetailRow label="Address">
              {record?.address ? (
                <span className="inline-flex items-start gap-1.5">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {record.address}
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </DetailRow>
            {record?.gstin ? <DetailRow label="GSTIN">{record.gstin}</DetailRow> : null}
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="statement">
        <TabsList>
          <TabsTrigger value="statement" className="gap-1.5">
            <BookOpen className="h-4 w-4" />
            Statement
          </TabsTrigger>
        </TabsList>

        <TabsContent value="statement" className="space-y-4">
          <DateRangeFilter value={range} onChange={setRange} />

          {statement.error ? (
            <ErrorState error={statement.error} onRetry={() => statement.refetch()} />
          ) : statement.isLoading ? (
            <LoadingState rows={3} />
          ) : !statement.data || statement.data.lines.length === 0 ? (
            <EmptyState
              title="No entries yet"
              description={`Bills and payments for this ${kind} will appear here.`}
            />
          ) : (
            <>
              <div className="rounded-xl border bg-card">
                <div className="w-full overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Document</TableHead>
                        <TableHead className="hidden sm:table-cell">Due</TableHead>
                        <TableHead className="text-right">Debit</TableHead>
                        <TableHead className="text-right">Credit</TableHead>
                        <TableHead className="text-right">Balance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow className="bg-muted/40">
                        <TableCell colSpan={5} className="text-xs font-medium text-muted-foreground">
                          Opening balance
                        </TableCell>
                        <TableCell className="text-right font-medium tabular">
                          <Money value={statement.data.openingBalance} />
                        </TableCell>
                      </TableRow>

                      {statement.data.lines.map((line, index) => (
                        <TableRow key={`${line.documentNumber ?? "line"}-${index}`}>
                          <TableCell className="whitespace-nowrap">{formatDate(line.date)}</TableCell>
                          <TableCell>
                            <span className="block font-medium">{line.label}</span>
                            <span className="block text-xs text-muted-foreground">
                              {line.documentNumber ?? "Opening balance"}
                            </span>
                          </TableCell>
                          <TableCell className="hidden whitespace-nowrap sm:table-cell">
                            {line.dueDate ? formatDate(line.dueDate) : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular">
                            {line.debit === "0.00" ? "—" : <Money value={line.debit} />}
                          </TableCell>
                          <TableCell className="text-right tabular">
                            {line.credit === "0.00" ? "—" : <Money value={line.credit} />}
                          </TableCell>
                          <TableCell className="text-right font-medium tabular">
                            <Money value={line.balance} />
                          </TableCell>
                        </TableRow>
                      ))}

                      <TableRow className="bg-muted/40">
                        <TableCell colSpan={5} className="text-xs font-semibold text-foreground">
                          Closing balance
                        </TableCell>
                        <TableCell className="text-right font-bold tabular">
                          <Money value={statement.data.closingBalance} tone="auto" />
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                {statement.data.balanceMeaning ?? config.statementMeaning}
              </p>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
