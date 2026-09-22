import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, parseISO, isValid } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formats monetary amounts in Indian Rupee format (or specified currency)
 * using standard 2-decimal display with proper commas.
 */
export function formatCurrency(
  amount: number | string | null | undefined,
  currency: string = "INR"
): string {
  if (amount === null || amount === undefined || amount === "") return "₹0.00";
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return "₹0.00";

  const formatted = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: currency || "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);

  return formatted;
}

/**
 * Formats a plain number with commas and specified decimal places.
 */
export function formatNumber(
  val: number | string | null | undefined,
  decimals: number = 2,
  fixedDecimals: boolean = false
): string {
  if (val === null || val === undefined || val === "") return "0";
  const num = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(num)) return "0";

  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: fixedDecimals ? decimals : 0,
    maximumFractionDigits: decimals,
  }).format(num);
}

/**
 * Formats a date string safely to DD/MM/YYYY or specified format.
 */
export function formatDate(
  dateInput: string | Date | null | undefined,
  dateFormat: string = "dd/MM/yyyy"
): string {
  if (!dateInput) return "—";
  try {
    const d = typeof dateInput === "string" ? parseISO(dateInput) : dateInput;
    if (!isValid(d)) return "—";
    return format(d, dateFormat);
  } catch {
    return "—";
  }
}

/**
 * Formats a date with time.
 */
export function formatDateTime(
  dateInput: string | Date | null | undefined
): string {
  return formatDate(dateInput, "dd/MM/yyyy hh:mm a");
}

/**
 * Returns initial avatar letters for a given name.
 */
export function getInitials(name: string | null | undefined): string {
  if (!name || !name.trim()) return "U";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
