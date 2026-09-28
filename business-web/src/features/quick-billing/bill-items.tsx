"use client";

import * as React from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import { EntitySelect } from "@/components/shared/entity-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * The items on a counter bill.
 *
 * Built for speed on a phone: pick an item and it lands on the bill with its
 * usual selling price and a quantity of 1; picking the same item again bumps
 * its quantity instead of adding a duplicate line (the backend refuses two
 * lines for one product anyway). Big +/- buttons, because typing "3" on a
 * phone keyboard is slower than tapping twice.
 *
 * No line totals are shown. Price x quantity, less discount, plus tax is the
 * backend's job; the bill total appears once the draft is saved.
 */

export interface BillLine {
  key: string;
  productId: string;
  label: string;
  quantity: string;
  unitPrice: string;
}

export function BillItems({
  lines,
  errors,
  disabled,
  onAdd,
  onChange,
  onRemove,
}: {
  lines: BillLine[];
  errors: Record<string, string>;
  disabled?: boolean;
  onAdd: (productId: string, label: string) => void;
  onChange: (key: string, patch: Partial<BillLine>) => void;
  onRemove: (key: string) => void;
}) {
  const step = (line: BillLine, direction: 1 | -1) => {
    const current = Number(line.quantity);
    const base = Number.isFinite(current) ? current : 0;
    const next = direction === 1 ? base + 1 : base - 1;
    // Never step below 1 - removing an item is the bin button's job, so a
    // stray tap cannot silently empty a line.
    onChange(line.key, { quantity: String(next < 1 ? 1 : next) });
  };

  return (
    <div className="space-y-3">
      {lines.length > 0 ? (
        <ul className="space-y-2">
          {lines.map((line) => (
            <li key={line.key} className="rounded-xl border bg-card p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 flex-1 truncate pt-2 text-sm font-medium">{line.label}</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 shrink-0"
                  aria-label={`Remove ${line.label}`}
                  disabled={disabled}
                  onClick={() => onRemove(line.key)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>

              <div className="mt-2 grid grid-cols-1 gap-3 min-[360px]:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground" htmlFor={`qty-${line.key}`}>
                    Quantity
                  </label>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-11 w-11 shrink-0"
                      aria-label="One less"
                      disabled={disabled}
                      onClick={() => step(line, -1)}
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                    <Input
                      id={`qty-${line.key}`}
                      inputMode="decimal"
                      value={line.quantity}
                      disabled={disabled}
                      onChange={(event) => onChange(line.key, { quantity: event.target.value })}
                      className={cn(
                        "h-11 min-w-0 flex-1 text-center",
                        errors[`qty-${line.key}`] && "border-destructive",
                      )}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-11 w-11 shrink-0"
                      aria-label="One more"
                      disabled={disabled}
                      onClick={() => step(line, 1)}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  {errors[`qty-${line.key}`] ? (
                    <p className="text-xs text-destructive">{errors[`qty-${line.key}`]}</p>
                  ) : null}
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground" htmlFor={`price-${line.key}`}>
                    Price each (₹)
                  </label>
                  <Input
                    id={`price-${line.key}`}
                    inputMode="decimal"
                    value={line.unitPrice}
                    disabled={disabled}
                    placeholder="0.00"
                    onChange={(event) => onChange(line.key, { unitPrice: event.target.value })}
                    className={cn("h-11", errors[`price-${line.key}`] && "border-destructive")}
                  />
                  {errors[`price-${line.key}`] ? (
                    <p className="text-xs text-destructive">{errors[`price-${line.key}`]}</p>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Always-empty picker: choosing an item adds it, then it resets for the
          next one. The fastest possible "scan the shelf" flow. */}
      <EntitySelect
        kind="product"
        value=""
        onChange={onAdd}
        placeholder={lines.length === 0 ? "Tap to add the first item" : "Add another item"}
        disabled={disabled}
        invalid={Boolean(errors.lines)}
      />
      {errors.lines ? <p className="text-xs text-destructive">{errors.lines}</p> : null}
    </div>
  );
}
