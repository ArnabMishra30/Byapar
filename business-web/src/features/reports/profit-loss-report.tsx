"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Scale, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { formatDate, toInputDate } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { StatCard } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { ErrorState, LoadingState } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ReportSection, ReportShell, StatGrid, periodLabel, rangeParams, useReportRange } from "./report-shell";
import { AmountLine } from "./report-parts";
import { reportCalls, type StatementBlock } from "./api";

/** A sign check for choosing a WORD ("profit" or "loss"); no arithmetic. */
function isNegative(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().startsWith("-");
}

/**
 * Profit & Loss, in shop words.
 *
 * Every line is the backend's figure from the general ledger; this screen only
 * lays them out in the order a shopkeeper reads them - sold, returned, what the
 * goods cost, what running the shop cost, what is left. The account-by-account
 * detail and the balance sheet are tucked away below for the accountant.
 */
export function ProfitLossReport() {
  const [range, setRange] = useReportRange();
  const params = rangeParams(range);
  const [showBalanceSheet, setShowBalanceSheet] = React.useState(false);

  const pl = useQuery({
    queryKey: ["report", "profit-loss", params],
    queryFn: () => reportCalls.profitLoss(params),
  });

  // The balance sheet is "as of" the end of the chosen period, or today.
  const asOf = params.toDate ?? toInputDate();
  const bs = useQuery({
    queryKey: ["report", "balance-sheet", asOf],
    queryFn: () => reportCalls.balanceSheet({ date: asOf }),
    enabled: showBalanceSheet,
  });

  const data = pl.data;
  const loss = isNegative(data?.netProfit);

  return (
    <ReportShell
      title="Profit & Loss"
      description="Did the shop make money? Sales, less what the goods cost, less expenses."
      range={range}
      onRangeChange={setRange}
    >
      <StatGrid>
        <StatCard
          label="Net sales"
          icon={TrendingUp}
          isLoading={pl.isLoading}
          value={<Money value={data?.netRevenue} />}
        />
        <StatCard
          label="Gross profit"
          icon={Wallet}
          isLoading={pl.isLoading}
          value={<Money value={data?.grossProfit} tone="auto" />}
          hint="Before expenses"
        />
        <StatCard
          label="Expenses"
          icon={TrendingDown}
          tone="dues"
          isLoading={pl.isLoading}
          value={<Money value={data?.otherExpenses.total} />}
        />
        <StatCard
          label={loss ? "Net loss" : "Net profit"}
          icon={Scale}
          tone={loss ? "dues" : "cash"}
          isLoading={pl.isLoading}
          value={<Money value={data?.netProfit} tone="auto" />}
        />
      </StatGrid>

      {pl.error ? (
        <ErrorState error={pl.error} onRetry={() => pl.refetch()} />
      ) : pl.isLoading || !data ? (
        <LoadingState rows={4} />
      ) : (
        <ReportSection title="The statement" description={periodLabel(range)}>
          <AmountLine label="Sales" hint="Everything you billed to customers" value={data.revenue.total} />
          <AmountLine label="Less: returns" hint="Goods customers brought back" value={data.salesReturns.total} />
          <AmountLine label="Net sales" value={data.netRevenue} strong />
          <AmountLine
            label="Less: cost of goods sold"
            hint="What the items you sold had cost you to buy"
            value={data.costOfGoodsSold.total}
          />
          <AmountLine label="Gross profit" hint="What you earned on the goods themselves" value={data.grossProfit} strong tone="auto" />
          <AmountLine
            label="Less: expenses"
            hint="Rent, salary, electricity and other running costs"
            value={data.otherExpenses.total}
          />
          <div
            className={cn(
              "mt-2 flex items-center justify-between gap-3 rounded-lg px-3 py-3",
              loss ? "bg-destructive/10" : "bg-success/10",
            )}
          >
            <div>
              <p className="text-sm font-bold text-foreground">{loss ? "Net loss" : "Net profit"}</p>
              <p className="text-xs text-muted-foreground">
                {loss ? "The shop spent more than it earned in this period." : "What the shop kept after everything."}
              </p>
            </div>
            <Money value={data.netProfit} tone="auto" className="shrink-0 text-lg font-bold" />
          </div>
        </ReportSection>
      )}

      {data ? (
        <ReportSection
          title="For your accountant"
          description="The same figures, account by account, from the general ledger."
        >
          <Accordion type="multiple">
            <BlockDetail value="revenue" title="Sales accounts" block={data.revenue} />
            <BlockDetail value="returns" title="Returns accounts" block={data.salesReturns} />
            <BlockDetail value="cogs" title="Cost of goods sold accounts" block={data.costOfGoodsSold} />
            <BlockDetail value="expenses" title="Expense accounts" block={data.otherExpenses} />
          </Accordion>
        </ReportSection>
      ) : null}

      <div data-print-hide>
        <Button
          variant="outline"
          className="w-full gap-2 sm:w-auto"
          aria-expanded={showBalanceSheet}
          onClick={() => setShowBalanceSheet((open) => !open)}
        >
          <ChevronDown className={cn("h-4 w-4 transition-transform", showBalanceSheet && "rotate-180")} />
          {showBalanceSheet ? "Hide balance sheet" : "Show balance sheet"}
        </Button>
      </div>

      {showBalanceSheet ? (
        bs.error ? (
          <ErrorState error={bs.error} onRetry={() => bs.refetch()} />
        ) : bs.isLoading || !bs.data ? (
          <LoadingState rows={3} />
        ) : (
          <ReportSection
            title="Balance sheet"
            description={`What the business owns and owes, as of ${formatDate(bs.data.asOfDate ?? asOf)}.`}
          >
            <div className="mb-3">
              {bs.data.isBalanced ? (
                <Badge variant="success">Books balance</Badge>
              ) : (
                <Badge variant="destructive">
                  Difference&nbsp;<Money value={bs.data.difference} />
                </Badge>
              )}
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <div>
                <p className="mb-1 text-sm font-semibold">What you own (assets)</p>
                {bs.data.assets.accounts.map((row) => (
                  <AmountLine key={row.accountId} label={row.name} hint={row.code} value={row.balance} />
                ))}
                <AmountLine label="Total assets" value={bs.data.totalAssets} strong />
              </div>
              <div>
                <p className="mb-1 text-sm font-semibold">What you owe (liabilities)</p>
                {bs.data.liabilities.accounts.map((row) => (
                  <AmountLine key={row.accountId} label={row.name} hint={row.code} value={row.balance} />
                ))}
                <AmountLine label="Total liabilities" value={bs.data.liabilities.total} strong />
                <p className="mb-1 mt-4 text-sm font-semibold">Owner&apos;s money (equity)</p>
                <AmountLine label="Capital" value={bs.data.equity.capital} />
                <AmountLine label="Profit kept in the business" value={bs.data.equity.retainedEarnings} tone="auto" />
                <AmountLine label="Total equity" value={bs.data.equity.total} strong />
                <AmountLine label="Liabilities and equity" value={bs.data.totalLiabilitiesAndEquity} strong />
              </div>
            </div>
          </ReportSection>
        )
      ) : null}
    </ReportShell>
  );
}

function BlockDetail({ value, title, block }: { value: string; title: string; block: StatementBlock }) {
  return (
    <AccordionItem value={value}>
      <AccordionTrigger>
        {title} ({block.accounts.length})
      </AccordionTrigger>
      <AccordionContent className="pr-0">
        {block.accounts.length === 0 ? (
          <p>No entries in this period.</p>
        ) : (
          block.accounts.map((row) => (
            <AmountLine key={row.accountId} label={row.name} hint={row.code} value={row.balance} />
          ))
        )}
      </AccordionContent>
    </AccordionItem>
  );
}
