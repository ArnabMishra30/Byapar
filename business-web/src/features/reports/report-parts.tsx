"use client";

import * as React from "react";
import { X } from "lucide-react";
import { EntitySelect } from "@/components/shared/entity-select";
import { Money } from "@/components/shared/money";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/shared/states";
import type { PaymentMethodRow } from "./api";

/** "BANK_TRANSFER" -> "Bank transfer". A label, never a figure. */
export function humanise(value: string | null | undefined): string {
  if (!value) return "—";
  const words = value.replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A party picker with a clear button, for narrowing a report to one party. */
export function PartyFilter({
  kind,
  value,
  onChange,
}: {
  kind: "customer" | "supplier";
  value: { id: string; name: string } | null;
  onChange: (next: { id: string; name: string } | null) => void;
}) {
  return (
    <div className="flex w-full items-center gap-2 sm:w-72">
      <div className="min-w-0 flex-1">
        <EntitySelect
          kind={kind}
          value={value?.id ?? null}
          valueLabel={value?.name ?? null}
          placeholder={kind === "customer" ? "All customers" : "All suppliers"}
          onChange={(id, name) => onChange({ id, name })}
        />
      </div>
      {value ? (
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 shrink-0"
          aria-label={kind === "customer" ? "Show all customers" : "Show all suppliers"}
          onClick={() => onChange(null)}
        >
          <X className="h-4 w-4" />
        </Button>
      ) : null}
    </div>
  );
}

/** Money split by how it was paid: cash, bank, UPI… straight from the backend. */
export function MethodBreakdown({
  rows,
  isLoading,
  error,
  onRetry,
  emptyText,
}: {
  rows: PaymentMethodRow[] | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  emptyText: string;
}) {
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (isLoading) return <LoadingState rows={2} />;
  if (!rows || rows.length === 0) return <p className="py-2 text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <ul className="divide-y">
      {rows.map((row) => (
        <li key={row.method} className="flex items-center justify-between gap-3 py-2.5 text-sm">
          <span className="min-w-0">
            <span className="font-medium text-foreground">{humanise(row.method)}</span>
            <span className="ml-2 text-xs text-muted-foreground">
              {row.count} {row.count === 1 ? "payment" : "payments"}
            </span>
          </span>
          <Money value={row.amount} className="font-semibold" />
        </li>
      ))}
    </ul>
  );
}

/** A label and a backend amount on one line, for statement-style blocks. */
export function AmountLine({
  label,
  hint,
  value,
  strong,
  tone,
}: {
  label: string;
  hint?: string;
  value: string | null | undefined;
  strong?: boolean;
  tone?: "auto" | "none";
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b py-2.5 last:border-0">
      <div className="min-w-0">
        <p className={strong ? "text-sm font-semibold text-foreground" : "text-sm text-foreground"}>{label}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      {value == null ? (
        <span className="text-sm text-muted-foreground">—</span>
      ) : (
        <Money
          value={value}
          tone={tone ?? "none"}
          className={strong ? "shrink-0 text-base font-bold" : "shrink-0 text-sm font-medium"}
        />
      )}
    </div>
  );
}

/** A secondary figure under the stat cards: smaller, still the backend's value. */
export function SmallFigure({ label, value, hint }: { label: string; value?: string | null; hint?: string }) {
  return (
    <div className="min-w-0 rounded-xl border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <Money value={value} className="block truncate text-base font-semibold" />
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
