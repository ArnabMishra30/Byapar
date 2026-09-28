"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { PlayCircle } from "lucide-react";
import { openingBalancesApi } from "@/lib/api";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, LoadingState, EmptyState } from "@/components/shared/states";
import { Money } from "@/components/shared/money";
import { DetailRow } from "@/components/shared/form-parts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import { NotAvailable } from "@/components/shared/not-available";
import { AccountingTabs } from "./accounting-tabs";

/**
 * Opening balances: the books a business already had when it started here.
 *
 * Set ONCE, and then history. The backend refuses a second initialization at the
 * database level, so this screen shows what was set rather than offering an edit
 * that could not succeed.
 */
interface OpeningStatus {
  initialized: boolean;
  asOfDate: string | null;
  journalNumber?: string;
  totalDebit?: string;
  totalCredit?: string;
  isBalanced?: boolean;
  initializedBy?: { name: string } | null;
  note?: string;
}

interface OpeningDetails {
  asOfDate: string;
  journalNumber: string;
  totals: { totalDebit: string; totalCredit: string; isBalanced: boolean };
  journal: { account: { code: string; name: string }; debit: string; credit: string }[];
  customers: { customerId: string; name: string; amount: string }[];
  suppliers: { supplierId: string; name: string; amount: string }[];
  inventory: { productId: string; name: string; quantity: string; totalValue: string }[];
  note?: string;
}

export function OpeningBalancePage() {
  const status = useQuery({
    queryKey: ["opening-balances"],
    queryFn: () => openingBalancesApi.status() as unknown as Promise<OpeningStatus>,
  });

  const details = useQuery({
    queryKey: ["opening-balances", "details"],
    queryFn: () => openingBalancesApi.details() as unknown as Promise<OpeningDetails>,
    enabled: status.data?.initialized === true,
  });

  // The header and tabs stay put while loading or on error, like every page.
  if (status.isLoading || status.error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Opening balances" description="Start with the books you already have." />
        <AccountingTabs />
        {status.error ? (
          <ErrorState error={status.error} onRetry={() => status.refetch()} />
        ) : (
          <LoadingState rows={3} />
        )}
      </div>
    );
  }

  if (!status.data?.initialized) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Opening balances"
          description="Start with the books you already have."
        />
        <AccountingTabs />
        <EmptyState
          icon={PlayCircle}
          title="No opening balances set"
          description="If your business was running before you started using Byapar, an opening balance records what you had on day one - cash, bank, stock, and who owed whom. Without it, your books start from zero, which is correct for a brand new business."
        />
        <NotAvailable
          features={[
            {
              title: "Set opening balances from this screen",
              description:
                "Recording day-one cash, bank, stock and dues is a one-time step that this screen cannot do yet. Ask your accountant or Byapar support to set it up.",
            },
          ]}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Opening balances"
        description={`Set as at ${formatDate(status.data.asOfDate)}`}
        actions={
          <Badge variant={status.data.isBalanced ? "success" : "destructive"}>
            {status.data.isBalanced ? "Balanced" : "Not balanced"}
          </Badge>
        }
      />
      <AccountingTabs />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">Summary</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <DetailRow label="As at">{formatDate(status.data.asOfDate)}</DetailRow>
          <DetailRow label="Entry number">{status.data.journalNumber ?? "—"}</DetailRow>
          <DetailRow label="Total">
            <Money value={status.data.totalDebit} />
          </DetailRow>
          <DetailRow label="Set by">{status.data.initializedBy?.name ?? "—"}</DetailRow>
        </CardContent>
      </Card>

      {details.isLoading ? (
        <LoadingState rows={2} />
      ) : details.error ? (
        <ErrorState error={details.error} onRetry={() => details.refetch()} />
      ) : details.data ? (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">What was recorded</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="w-full overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account</TableHead>
                      <TableHead className="text-right">Debit</TableHead>
                      <TableHead className="text-right">Credit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {details.data.journal.map((line, index) => (
                      <TableRow key={index}>
                        <TableCell>
                          <span className="block font-medium">{line.account.name}</span>
                          <span className="block text-xs text-muted-foreground">{line.account.code}</span>
                        </TableCell>
                        <TableCell className="text-right tabular">
                          {line.debit === "0.00" ? "—" : <Money value={line.debit} />}
                        </TableCell>
                        <TableCell className="text-right tabular">
                          {line.credit === "0.00" ? "—" : <Money value={line.credit} />}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {details.data.note ? (
            <p className="text-xs text-muted-foreground">{details.data.note}</p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
