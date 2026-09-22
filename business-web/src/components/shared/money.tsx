import * as React from "react";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/utils";

/**
 * Money, rendered from the backend string without arithmetic.
 *
 * "tone=auto" colours a negative figure red and a positive one neutral - not
 * green, because most numbers in a shop are positive and a wall of green means
 * nothing.
 */
export function Money({
  value,
  currency = "INR",
  tone = "none",
  className,
}: {
  value: string | number | null | undefined;
  currency?: string;
  tone?: "none" | "auto" | "positive" | "negative";
  className?: string;
}) {
  const numeric = typeof value === "string" ? Number(value) : value ?? 0;
  const resolved =
    tone === "auto" ? (Number.isFinite(numeric) && numeric < 0 ? "negative" : "none") : tone;

  return (
    <span
      className={cn(
        "tabular",
        resolved === "negative" && "text-destructive",
        resolved === "positive" && "text-success",
        className,
      )}
    >
      {formatMoney(value, currency)}
    </span>
  );
}
