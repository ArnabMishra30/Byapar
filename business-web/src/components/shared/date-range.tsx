"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn, daysAgo, startOfMonth } from "@/lib/utils";

export interface DateRangeValue {
  fromDate?: string;
  toDate?: string;
  /** Lets a range be spread straight into an API call. */
  [key: string]: unknown;
}

/**
 * A date range with the shortcuts a shop actually uses.
 *
 * WHAT WAS WRONG BEFORE, and why this looks the way it does now.
 *
 * The two date inputs were a fixed 9.5rem (152px) each. At 320px, minus page
 * padding, there is ~288px of usable width - so they could not sit side by side
 * and wrapped onto separate rows, each carrying its own label above it. Four
 * stacked rows of chrome before a single expense appeared.
 *
 * Now:
 *   - the presets are a SINGLE horizontally-scrollable row of chips, so five
 *     shortcuts cost one row instead of two wrapped ones
 *   - the two dates are a 2-column grid, each 50% of whatever is available, so
 *     they fit at 320px and grow on a laptop
 *   - the labels are inside the row rather than above it
 *
 * Native date inputs, deliberately: they get the phone's own date picker, which
 * every user already knows, and they need no library.
 */
export function DateRangeFilter({
  value,
  onChange,
  className,
}: {
  value: DateRangeValue;
  onChange: (next: DateRangeValue) => void;
  className?: string;
}) {
  const today = new Date().toISOString().slice(0, 10);

  const presets: { label: string; range: DateRangeValue }[] = [
    { label: "Today", range: { fromDate: today, toDate: today } },
    { label: "7 days", range: { fromDate: daysAgo(6), toDate: today } },
    { label: "30 days", range: { fromDate: daysAgo(29), toDate: today } },
    { label: "This month", range: { fromDate: startOfMonth(), toDate: today } },
    { label: "All", range: {} },
  ];

  /** Which chip is currently in effect, so the active filter is never a guess. */
  const activePreset = presets.find(
    (preset) =>
      (preset.range.fromDate ?? undefined) === (value.fromDate ?? undefined) &&
      (preset.range.toDate ?? undefined) === (value.toDate ?? undefined),
  );

  return (
    <div className={cn("space-y-2", className)}>
      {/*
        One scrollable row. -mx-1 px-1 lets the chips bleed to the screen edge
        so the last one does not look clipped, and the page itself never scrolls
        sideways because the overflow is owned here.
      */}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {presets.map((preset) => {
          const active = activePreset?.label === preset.label;
          return (
            <button
              key={preset.label}
              type="button"
              aria-pressed={active}
              onClick={() => onChange({ ...value, ...preset.range })}
              className={cn(
                // 32px tall and generously padded: a chip is a touch target.
                "h-8 shrink-0 rounded-full border px-3 text-xs font-medium transition-colors",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input bg-background text-muted-foreground hover:bg-muted",
              )}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      {/* Two equal columns. Never a fixed pixel width, so 320px is fine. */}
      <div className="grid grid-cols-2 gap-2">
        <label className="flex h-9 items-center gap-1.5 rounded-lg border border-input bg-background px-2">
          <span className="shrink-0 text-[11px] font-medium text-muted-foreground">From</span>
          <Input
            type="date"
            aria-label="From date"
            className="h-auto min-w-0 flex-1 border-0 bg-transparent p-0 text-xs shadow-none focus-visible:ring-0"
            value={value.fromDate ?? ""}
            max={value.toDate || undefined}
            onChange={(e) => onChange({ ...value, fromDate: e.target.value || undefined })}
          />
        </label>

        <label className="flex h-9 items-center gap-1.5 rounded-lg border border-input bg-background px-2">
          <span className="shrink-0 text-[11px] font-medium text-muted-foreground">To</span>
          <Input
            type="date"
            aria-label="To date"
            className="h-auto min-w-0 flex-1 border-0 bg-transparent p-0 text-xs shadow-none focus-visible:ring-0"
            value={value.toDate ?? ""}
            min={value.fromDate || undefined}
            onChange={(e) => onChange({ ...value, toDate: e.target.value || undefined })}
          />
        </label>
      </div>
    </div>
  );
}
