import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Money for display.
 *
 * The backend sends money as a STRING with two decimals, deliberately: it is
 * Decimal all the way through and never becomes a float. We parse only to place
 * separators, never to do arithmetic - Business Web performs no money
 * arithmetic at all, because the general ledger already did it.
 */
export function formatMoney(
  value: string | number | null | undefined,
  currency = "INR",
): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(n)) return String(value);

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(n);
}

/** Money without the symbol, for tables where the column header carries it. */
export function formatAmount(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(n)) return String(value);
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(n);
}

/**
 * A business date, shown as YYYY/MM/DD everywhere in this application.
 *
 * ONE FORMAT, NO EXCEPTIONS. A shop reads dates in tables, on bills and in
 * filters; switching between "01 Apr 2026" and "01/04/2026" is how a person
 * misreads a due date. YYYY/MM/DD sorts correctly when read as text and is
 * unambiguous about which number is the month.
 *
 * Read in UTC, because the backend stores business dates at UTC midnight. Using
 * local getters would show the previous day for anyone east of Greenwich.
 */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "\u2014";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "\u2014";

  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return year + "/" + month + "/" + day;
}

/** The same date, plus a local clock time. Used for audit trails only. */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "\u2014";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "\u2014";

  const time = new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
  return formatDate(d) + " " + time;
}

/** "YYYY-MM-DD" for an <input type="date"> and for the API. */
export function toInputDate(value: Date = new Date()): string {
  return value.toISOString().slice(0, 10);
}

/** Whether a money string is greater than zero, without float arithmetic. */
export function isPositiveAmount(value: string | number | null | undefined): boolean {
  if (value === null || value === undefined || value === "") return false;
  const n = typeof value === "string" ? Number(value) : value;
  return !Number.isNaN(n) && n > 0;
}

export function initials(name?: string | null): string {
  if (!name) return "?";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** The first day of the current month, as the API wants it. */
export function startOfMonth(date: Date = new Date()): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

/** N days back from today, as "YYYY-MM-DD". */
export function daysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Turns a backend field path like "body.items.0.quantity" into "items.0.quantity". */
export function stripBodyPrefix(field: string): string {
  return field.replace(/^body\./, "");
}
