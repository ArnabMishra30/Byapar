/**
 * Small pure helpers for the returns and payables screens.
 *
 * None of these touch money. Quantities are compared (never priced) so the form
 * can stop someone typing "12" against a line that has 5 left before the
 * backend has to refuse it. The backend re-checks everything anyway.
 */

/** Quantities are stored to 3 decimals on the backend. */
const QUANTITY_PATTERN = /^\d+(\.\d{1,3})?$/;

/**
 * A quantity string as whole thousandths, so "1.5" and "1.500" compare equal
 * without floating-point surprises. Returns null for anything that is not a
 * plain non-negative number with at most 3 decimals.
 */
export function toThousandths(value: string): number | null {
  const trimmed = value.trim();
  if (!QUANTITY_PATTERN.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.split(".");
  return Number(whole) * 1000 + Number(fraction.padEnd(3, "0"));
}

export type QuantityCheck =
  | { ok: true; skip: true }
  | { ok: true; skip: false; quantity: string }
  | { ok: false; error: string };

/**
 * Checks what someone typed into a "return quantity" box.
 *
 *   ""  or "0"          -> the line is not being returned (skip)
 *   more than remaining -> error naming the limit
 *   bad format          -> error
 *
 * `remaining` is the backend's remainingQuantity for the line.
 */
export function checkReturnQuantity(input: string, remaining: string): QuantityCheck {
  const trimmed = input.trim();
  if (trimmed === "") return { ok: true, skip: true };

  const typed = toThousandths(trimmed);
  if (typed === null) {
    return { ok: false, error: "Enter a number with up to 3 decimals" };
  }
  if (typed === 0) return { ok: true, skip: true };

  const limit = toThousandths(remaining) ?? 0;
  if (typed > limit) {
    return { ok: false, error: `Only ${formatQuantity(remaining)} can be returned` };
  }
  return { ok: true, skip: false, quantity: trimmed };
}

/** Whether a line still has anything left to return. */
export function hasRemaining(remaining: string): boolean {
  return (toThousandths(remaining) ?? 0) > 0;
}

/** "5.000" -> "5", "2.500" -> "2.5". Display only. */
export function formatQuantity(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  if (!/^-?\d+(\.\d+)?$/.test(value)) return value;
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}

/**
 * The reason sent to the backend: the picked reason, plus the free text when
 * there is some. Empty when neither is given, so nothing is invented.
 */
export function buildReturnReason(choice: string, detail: string): string | undefined {
  const picked = choice.trim();
  const extra = detail.trim();
  if (!picked && !extra) return undefined;
  const combined =
    picked === "Other" || !picked ? extra || picked : extra ? `${picked}: ${extra}` : picked;
  // The backend refuses anything over 200 characters.
  return combined.slice(0, 200);
}

/**
 * Whole days between a due date and today (UTC business dates).
 * Positive = overdue by that many days, 0 = due today, negative = not due yet.
 * Null when there is no due date. This is date arithmetic, not money.
 */
export function daysPastDue(dueDate: string | null | undefined, today: Date = new Date()): number | null {
  if (!dueDate) return null;
  const due = new Date(`${dueDate.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(due.getTime())) return null;
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((todayUtc - due.getTime()) / 86_400_000);
}

/** "Due in 3 days", "Due today", "12 days late". */
export function describeDue(days: number | null): string {
  if (days === null) return "No due date";
  if (days === 0) return "Due today";
  if (days < 0) return `Due in ${-days} day${days === -1 ? "" : "s"}`;
  return `${days} day${days === 1 ? "" : "s"} late`;
}

/** "YYYY-MM-DD", N days from today (UTC), for due-date filters. */
export function daysFromToday(days: number, today: Date = new Date()): string {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
