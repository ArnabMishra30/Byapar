import { DETAIL_ROUTES } from "@/lib/constants";

/**
 * Pure helpers for the stock screens.
 *
 * Kept free of React so the rules a shopkeeper depends on - what a movement is
 * called, which way an adjustment moves stock, how the reason is stored - are
 * tested directly rather than through a rendered page.
 */

// --- movement types --------------------------------------------------------

export type MovementType =
  | "OPENING_STOCK"
  | "STOCK_IN"
  | "STOCK_OUT"
  | "ADJUSTMENT_IN"
  | "ADJUSTMENT_OUT";

/** Shop words for each backend movement type. */
export const MOVEMENT_TYPE_LABEL: Record<MovementType, string> = {
  OPENING_STOCK: "Opening stock",
  STOCK_IN: "Stock in (purchase)",
  STOCK_OUT: "Stock out (sale)",
  ADJUSTMENT_IN: "Added (adjustment)",
  ADJUSTMENT_OUT: "Removed (adjustment)",
};

export function movementLabel(type: string | null | undefined): string {
  if (!type) return "—";
  return MOVEMENT_TYPE_LABEL[type as MovementType] ?? type;
}

/** Whether a movement adds to stock. Used only for the +/- sign and colour. */
export function isInward(type: string | null | undefined): boolean {
  return type === "OPENING_STOCK" || type === "STOCK_IN" || type === "ADJUSTMENT_IN";
}

// --- references ------------------------------------------------------------

/**
 * Where a movement came from, as a link and a label.
 *
 * The backend writes these referenceType values (see the *_REFERENCE_TYPE
 * constants in the sales, purchases, returns and inventory services). Opening
 * stock and adjustments have no document to open, so they get a label only.
 */
export function movementReference(
  referenceType: string | null | undefined,
  referenceId: string | null | undefined,
): { label: string; href?: string } {
  switch (referenceType) {
    case "SALES_INVOICE":
      return { label: "Sale", href: referenceId ? DETAIL_ROUTES.sale(referenceId) : undefined };
    case "PURCHASE":
      return { label: "Purchase", href: referenceId ? DETAIL_ROUTES.purchase(referenceId) : undefined };
    case "SALES_RETURN":
      return {
        label: "Sales return",
        href: referenceId ? DETAIL_ROUTES.salesReturn(referenceId) : undefined,
      };
    case "PURCHASE_RETURN":
      return {
        label: "Purchase return",
        href: referenceId ? DETAIL_ROUTES.purchaseReturn(referenceId) : undefined,
      };
    case "OPENING_STOCK":
      return { label: "Opening stock" };
    case "STOCK_ADJUSTMENT":
      return { label: "Adjustment" };
    default:
      return { label: referenceType ? referenceType : "—" };
  }
}

// --- display -----------------------------------------------------------------

/**
 * A quantity as a shopkeeper writes it: "12", "2.5", "0.125" - never "12.000".
 * Formatting only; the number is the backend's.
 */
export function formatQuantity(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return String(value);
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(n);
}

// --- stock level -------------------------------------------------------------

export type StockLevel = "out" | "low" | "ok";

/**
 * How a shopkeeper reads a row at a glance. A comparison, not a calculation:
 * both numbers come from the backend.
 *
 * Out of stock first, because it is a problem now. Low only when a minimum
 * level has actually been set - a product with no minimum is never "low".
 */
export function stockLevel(
  quantity: string | number | null | undefined,
  reorderLevel: string | number | null | undefined,
): StockLevel {
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) return "out";
  const min = Number(reorderLevel ?? 0);
  if (Number.isFinite(min) && min > 0 && qty <= min) return "low";
  return "ok";
}

export function isOutOfStock(quantity: string | number | null | undefined): boolean {
  const qty = Number(quantity);
  return !Number.isFinite(qty) || qty <= 0;
}

// --- adjustments -------------------------------------------------------------

export type AdjustmentReason = "DAMAGED" | "LOST" | "EXPIRED" | "FOUND" | "COUNT" | "OTHER";
export type AdjustmentDirection = "ADJUSTMENT_IN" | "ADJUSTMENT_OUT";

export const ADJUSTMENT_REASONS: {
  value: AdjustmentReason;
  label: string;
  /** Fixed direction, or null when the shopkeeper chooses. */
  direction: AdjustmentDirection | null;
}[] = [
  { value: "DAMAGED", label: "Damaged", direction: "ADJUSTMENT_OUT" },
  { value: "LOST", label: "Lost / stolen", direction: "ADJUSTMENT_OUT" },
  { value: "EXPIRED", label: "Expired", direction: "ADJUSTMENT_OUT" },
  { value: "FOUND", label: "Found extra stock", direction: "ADJUSTMENT_IN" },
  { value: "COUNT", label: "Physical count difference", direction: null },
  { value: "OTHER", label: "Other", direction: null },
];

/**
 * The backend adjustment type for a reason.
 *
 * Damaged, lost and expired can only take stock away; found can only add it.
 * For a count difference or "other" the shopkeeper says which way, and until
 * they do there is no type (the form must not guess).
 */
export function adjustmentTypeFor(
  reason: AdjustmentReason | "" | null | undefined,
  chosen?: AdjustmentDirection | "" | null,
): AdjustmentDirection | null {
  if (!reason) return null;
  const entry = ADJUSTMENT_REASONS.find((r) => r.value === reason);
  if (!entry) return null;
  if (entry.direction) return entry.direction;
  return chosen || null;
}

export function reasonLabel(reason: AdjustmentReason | "" | null | undefined): string {
  return ADJUSTMENT_REASONS.find((r) => r.value === reason)?.label ?? "";
}

/** The backend caps notes at 500 characters. */
export const NOTES_MAX = 500;

/**
 * The notes sent with an adjustment: "<Reason>: <notes>".
 *
 * The backend has no reason field, so the reason is stored at the front of the
 * notes. That keeps it visible in the movement history for ever, instead of
 * being lost the moment the form closes.
 */
export function formatAdjustmentNotes(
  reason: AdjustmentReason | "" | null | undefined,
  notes: string | null | undefined,
): string | undefined {
  const label = reasonLabel(reason);
  const text = (notes ?? "").trim();
  const combined = label && text ? `${label}: ${text}` : label || text;
  if (!combined) return undefined;
  return combined.slice(0, NOTES_MAX);
}

/** Today's date as the backend filters movements (createdAt, local day). */
export function todayRange(now: Date = new Date()): { fromDate: string; toDate: string } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return { fromDate: start.toISOString(), toDate: end.toISOString() };
}
