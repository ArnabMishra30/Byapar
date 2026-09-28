"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select-native";
import { Money } from "@/components/shared/money";
import { cn } from "@/lib/utils";

/**
 * "How is the customer paying?" - asked once, at the counter.
 *
 *   Full       the whole bill, as the backend totals it, is received now
 *   Part       some of it now, the rest goes on the customer's account
 *   On credit  nothing now; the whole bill goes on the customer's account
 *
 * For "Full" the amount is never typed or worked out here: after the bill is
 * posted, the payment is made for exactly what the backend says is due on it.
 */

export type PayMode = "FULL" | "PART" | "CREDIT";

/** The methods the customer-payments API accepts, in shop words. */
export const PAYMENT_METHODS = [
  { value: "CASH", label: "Cash" },
  { value: "UPI", label: "UPI" },
  { value: "BANK", label: "Bank" },
  { value: "CHEQUE", label: "Cheque" },
  { value: "OTHER", label: "Other" },
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number]["value"];

const MODES: { value: PayMode; label: string; hint: string }[] = [
  { value: "FULL", label: "Full", hint: "Paid in full now" },
  { value: "PART", label: "Part", hint: "Some now, rest on credit" },
  { value: "CREDIT", label: "On credit", hint: "Pay later" },
];

export function PaymentSection({
  mode,
  onModeChange,
  amount,
  onAmountChange,
  method,
  onMethodChange,
  grandTotal,
  error,
  disabled,
}: {
  mode: PayMode;
  onModeChange: (mode: PayMode) => void;
  amount: string;
  onAmountChange: (value: string) => void;
  method: PaymentMethod;
  onMethodChange: (method: PaymentMethod) => void;
  /** The saved draft's total from the backend, if there is an up-to-date one. */
  grandTotal?: string | null;
  error?: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold">Payment</p>

      <div className="grid grid-cols-3 gap-2" role="group" aria-label="How the customer pays">
        {MODES.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={mode === option.value}
            disabled={disabled}
            onClick={() => onModeChange(option.value)}
            className={cn(
              "flex min-h-[3.25rem] flex-col items-center justify-center rounded-lg border-2 px-1 py-2 text-center transition-colors disabled:opacity-50",
              mode === option.value
                ? "border-primary bg-primary/5"
                : "border-border hover:bg-muted/50",
            )}
          >
            <span className="text-sm font-semibold leading-tight">{option.label}</span>
            <span className="text-[10px] leading-tight text-muted-foreground">{option.hint}</span>
          </button>
        ))}
      </div>

      {mode === "CREDIT" ? (
        <p className="text-xs text-muted-foreground">
          The whole bill will be added to what this customer owes you.
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {mode === "PART" ? (
            <div className="space-y-1">
              <label htmlFor="qb-paid" className="text-xs text-muted-foreground">
                Paid now (₹)
              </label>
              <Input
                id="qb-paid"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                disabled={disabled}
                onChange={(event) => onAmountChange(event.target.value)}
                className={cn("h-11", error && "border-destructive")}
              />
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Paid now</p>
              <p className="flex h-11 items-center rounded-lg border bg-muted/30 px-3 text-sm font-medium">
                {grandTotal ? <Money value={grandTotal} /> : "The full bill total"}
              </p>
            </div>
          )}

          <div className="space-y-1">
            <label htmlFor="qb-method" className="text-xs text-muted-foreground">
              Paid by
            </label>
            <NativeSelect
              id="qb-method"
              value={method}
              disabled={disabled}
              onChange={(event) => onMethodChange(event.target.value as PaymentMethod)}
              className="h-11"
            >
              {PAYMENT_METHODS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          {error ? <p className="text-xs text-destructive sm:col-span-2">{error}</p> : null}
        </div>
      )}
    </div>
  );
}
