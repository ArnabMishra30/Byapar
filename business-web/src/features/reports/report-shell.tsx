"use client";

import * as React from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { ROUTES } from "@/lib/constants";
import { startOfMonth, toInputDate, formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { ModuleTabs, type ModuleTab } from "@/components/shared/module-tabs";
import { PrintActions } from "@/components/shared/print-actions";
import { DateRangeFilter, type DateRangeValue } from "@/components/shared/date-range";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * The frame every report page shares: title, the row of report tabs, the
 * period, and print/share.
 *
 * One frame so that moving from "Sales" to "Expenses" changes the figures and
 * nothing else - the date you picked, the buttons and the layout stay where
 * the eye already is.
 */

/** Reports open on "this month": the question a shopkeeper asks most. */
export function useReportRange(): [DateRangeValue, (next: DateRangeValue) => void] {
  const [range, setRange] = React.useState<DateRangeValue>(() => ({
    fromDate: startOfMonth(),
    toDate: toInputDate(),
  }));
  return [range, setRange];
}

/** Only the two dates, never the index signature, so query keys stay stable. */
export function rangeParams(range: DateRangeValue): { fromDate?: string; toDate?: string } {
  return { fromDate: range.fromDate || undefined, toDate: range.toDate || undefined };
}

export function periodLabel(range: { fromDate?: string | null; toDate?: string | null }): string {
  if (!range.fromDate && !range.toDate) return "All time";
  if (range.fromDate && range.toDate) return `${formatDate(range.fromDate)} – ${formatDate(range.toDate)}`;
  if (range.fromDate) return `From ${formatDate(range.fromDate)}`;
  return `Up to ${formatDate(range.toDate)}`;
}

export function ReportTabs() {
  const { isGstEnabled } = useAuth();
  const tabs: ModuleTab[] = [
    { label: "Sales", href: ROUTES.salesReport },
    { label: "Purchases", href: ROUTES.purchaseReport },
    { label: "Stock", href: ROUTES.stockReport },
    { label: "Customers", href: ROUTES.customerReport },
    { label: "Suppliers", href: ROUTES.supplierReport },
    { label: "Expenses", href: ROUTES.expenseReport },
    { label: "Profit & Loss", href: ROUTES.profitLoss },
    // A shop without GST never sees a tax tab.
    { label: "GST", href: ROUTES.gstReport, show: isGstEnabled },
  ];
  return <ModuleTabs tabs={tabs} />;
}

export function ReportShell({
  title,
  description,
  range,
  onRangeChange,
  filters,
  children,
}: {
  title: string;
  description: string;
  /** Omit for "as of today" reports (stock, who owes whom). */
  range?: DateRangeValue;
  onRangeChange?: (next: DateRangeValue) => void;
  /** Extra controls beside the period: a customer picker, a toggle. */
  filters?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />
      <ReportTabs />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1 space-y-3" data-print-hide>
          {range && onRangeChange ? (
            <div className="w-full sm:max-w-md">
              <DateRangeFilter value={range} onChange={onRangeChange} />
            </div>
          ) : null}
          {filters ? <div className="flex flex-wrap items-center gap-2">{filters}</div> : null}
        </div>
        <PrintActions title={title} />
      </div>

      {/* On paper the chosen period is the first thing an accountant checks. */}
      {range ? (
        <p className="hidden text-sm text-muted-foreground print:block">Period: {periodLabel(range)}</p>
      ) : null}

      {children}
    </div>
  );
}

/** A titled card around one block of a report. */
export function ReportSection({
  title,
  description,
  children,
  className,
  contentClassName,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className={cn("pt-0", contentClassName)}>{children}</CardContent>
    </Card>
  );
}

/** The grid summary cards sit in: two across on a phone, four on a laptop. */
export function StatGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>;
}

/** A small toggle chip, e.g. "Overdue only". A real button with aria-pressed. */
export function ToggleChip({
  pressed,
  onPressedChange,
  children,
}: {
  pressed: boolean;
  onPressedChange: (next: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        "inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors sm:min-h-9",
        pressed
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-background text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

/** The backend's own caveat on a report, kept visible rather than dropped. */
export function ReportNote({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>;
}
