import type {
  PaymentStatus,
  PurchaseRegister,
  SalesRegister,
} from "@/lib/api/extended";
import type { Pagination } from "@/types/api";

/**
 * Pure helpers for the sale / purchase screens.
 *
 * Kept free of React so they can be tested directly. NONE of them does money
 * arithmetic: they reshape what the backend said, compare it with zero, or
 * build a request body out of what the user typed. Totals, tax, paid and due
 * are always the backend's figures.
 */

// --- one row, whichever list it came from ----------------------------------

/**
 * A sale or purchase as the list screens show it.
 *
 * Completed documents come from the register (which knows paid and due);
 * drafts and cancelled ones come from the plain document list (which does not).
 * Normalising both to this shape lets one table render either.
 */
export interface DocRow {
  id: string;
  number: string;
  /** Purchases only: the number printed on the supplier's own bill. */
  supplierBillNumber?: string | null;
  date: string;
  dueDate?: string | null;
  partyId?: string;
  partyName: string;
  total: string;
  /** Only known for completed documents. Undefined means "not known", not zero. */
  paid?: string;
  due?: string;
  paymentStatus?: PaymentStatus;
  status: string;
}

export interface RegisterPage {
  rows: DocRow[];
  pagination: Pagination;
  totals: {
    count: number;
    total: string;
    returns?: string;
    returnCount?: number;
    net?: string;
  };
}

export function fromSalesRegister(register: SalesRegister): RegisterPage {
  return {
    rows: (register.invoices ?? []).map((row) => ({
      id: row.id,
      number: row.invoiceNumber,
      date: row.invoiceDate,
      dueDate: row.dueDate,
      partyId: row.customer?.id,
      partyName: row.customer?.name ?? "",
      total: row.total,
      paid: row.paid,
      due: row.outstanding,
      paymentStatus: row.paymentStatus,
      status: "POSTED",
    })),
    pagination: register.pagination,
    totals: {
      count: register.totals?.invoiceCount ?? 0,
      total: register.totals?.total ?? "0",
      returns: register.totals?.returns,
      returnCount: register.totals?.returnCount,
      net: register.totals?.netSales,
    },
  };
}

export function fromPurchaseRegister(register: PurchaseRegister): RegisterPage {
  return {
    rows: (register.bills ?? []).map((row) => ({
      id: row.id,
      number: row.purchaseNumber,
      supplierBillNumber: row.supplierInvoiceNumber,
      date: row.invoiceDate,
      dueDate: row.dueDate,
      partyId: row.supplier?.id,
      partyName: row.supplier?.name ?? "",
      total: row.total,
      paid: row.paid,
      due: row.outstanding,
      paymentStatus: row.paymentStatus,
      status: "POSTED",
    })),
    pagination: register.pagination,
    totals: {
      count: register.totals?.billCount ?? 0,
      total: register.totals?.total ?? "0",
      returns: register.totals?.returns,
      returnCount: register.totals?.returnCount,
      net: register.totals?.netPurchases,
    },
  };
}

/** A draft or cancelled document from /sales or /purchases, as a row. */
export function fromDocument(kind: "sale" | "purchase", doc: Record<string, unknown>): DocRow {
  const partyKey = kind === "sale" ? "customer" : "supplier";
  const party = doc[partyKey] as { id?: string; name?: string } | undefined;
  const snapshot = kind === "sale" ? doc.customerNameSnapshot : doc.supplierNameSnapshot;
  return {
    id: String(doc.id ?? ""),
    number: String((kind === "sale" ? doc.invoiceNumber : doc.purchaseNumber) ?? ""),
    supplierBillNumber: kind === "purchase" ? ((doc.invoiceNumber as string | undefined) ?? null) : undefined,
    date: String(doc.invoiceDate ?? ""),
    dueDate: (doc.dueDate as string | null | undefined) ?? null,
    partyId: party?.id,
    partyName: party?.name ?? (typeof snapshot === "string" ? snapshot : ""),
    total: String(doc.grandTotal ?? "0"),
    status: String(doc.status ?? ""),
  };
}

// --- comparisons, never arithmetic ------------------------------------------

/** Whether a backend money string is more than zero. Missing is not "due". */
export function isPositive(value: string | number | null | undefined): boolean {
  if (value == null || value === "") return false;
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

/** Whether a backend money string is anything other than zero. */
export function isNonZero(value: unknown): boolean {
  if (value == null || value === "") return false;
  const n = Number(value);
  return Number.isFinite(n) && n !== 0;
}

/** The payment state in the words on the shop counter. */
export function paymentStatusLabel(status: PaymentStatus | string | undefined): string {
  switch (status) {
    case "OPEN":
      return "Not paid";
    case "PARTIALLY_PAID":
      return "Part paid";
    case "PAID":
      return "Fully paid";
    case "CREDITED":
      return "Settled by return";
    case "CANCELLED":
      return "Cancelled";
    default:
      return "—";
  }
}

// --- list tabs ---------------------------------------------------------------

export type DocTab = "completed" | "drafts" | "cancelled";

export const DOC_TABS: { value: DocTab; label: string; status?: "DRAFT" | "CANCELLED" }[] = [
  { value: "completed", label: "Completed" },
  { value: "drafts", label: "Drafts", status: "DRAFT" },
  { value: "cancelled", label: "Cancelled", status: "CANCELLED" },
];

/** Reads ?tab= defensively: anything unknown falls back to Completed. */
export function parseTab(value: string | null | undefined): DocTab {
  return value === "drafts" || value === "cancelled" ? value : "completed";
}

// --- the form ----------------------------------------------------------------

export type DiscountKind = "FIXED" | "PERCENTAGE";

export interface LineRow {
  key: string;
  productId: string;
  productLabel: string;
  quantity: string;
  amount: string;
  discountType: DiscountKind;
  discountValue: string;
  /**
   * The tax the line was saved with. Kept on edit so re-saving a draft does
   * not silently swap the tax; a new line leaves it to the product's default.
   */
  taxId?: string | null;
}

let lineSeq = 0;
export const emptyLine = (): LineRow => ({
  key: `line-${Date.now().toString(36)}-${(lineSeq += 1)}`,
  productId: "",
  productLabel: "",
  quantity: "1",
  amount: "",
  discountType: "FIXED",
  discountValue: "",
});

/** Trailing zeros off a backend decimal, so "2.000000" edits as "2". */
export function trimDecimal(value: unknown): string {
  if (value == null) return "";
  const text = String(value);
  if (!/^-?\d+(\.\d+)?$/.test(text)) return text;
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}

/** A saved line, back into the editable shape. */
export function lineFromItem(
  item: Record<string, unknown>,
  amountField: "unitPrice" | "unitCost",
): LineRow {
  const type = item.discountType === "PERCENTAGE" ? "PERCENTAGE" : "FIXED";
  const hasDiscount = item.discountType === "PERCENTAGE" || item.discountType === "FIXED";
  return {
    ...emptyLine(),
    productId: String(item.productId ?? ""),
    productLabel: String(item.productNameSnapshot ?? item.productName ?? ""),
    quantity: trimDecimal(item.quantity),
    amount: trimDecimal(item[amountField]),
    discountType: type,
    discountValue: hasDiscount && isNonZero(item.discountValue) ? trimDecimal(item.discountValue) : "",
    taxId: (item.taxId as string | null | undefined) ?? null,
  };
}

export interface DocumentFormValues {
  partyField: "customerId" | "supplierId";
  partyId: string;
  warehouseId: string;
  date: string;
  dueDate: string;
  notes: string;
  amountField: "unitPrice" | "unitCost";
  /** Purchases only. */
  supplierInvoiceNumber?: string;
  /** Sales only, and only when editing a draft for the SAME customer. */
  placeOfSupplyStateCode?: string | null;
  lines: LineRow[];
}

/**
 * The body POST and PATCH both take. The backend's update is a full
 * replacement (same schema as create), so an edit sends the whole document.
 * Numbers stay strings: the backend parses them as decimals.
 */
export function buildDocumentBody(values: DocumentFormValues): Record<string, unknown> {
  return {
    [values.partyField]: values.partyId,
    warehouseId: values.warehouseId,
    invoiceDate: values.date,
    dueDate: values.dueDate ? values.dueDate : null,
    notes: values.notes.trim() ? values.notes.trim() : null,
    ...(values.supplierInvoiceNumber !== undefined
      ? { invoiceNumber: values.supplierInvoiceNumber.trim() }
      : {}),
    ...(values.placeOfSupplyStateCode ? { placeOfSupplyStateCode: values.placeOfSupplyStateCode } : {}),
    items: values.lines
      .filter((line) => line.productId)
      .map((line) => ({
        productId: line.productId,
        ...(line.taxId ? { taxId: line.taxId } : {}),
        quantity: line.quantity.trim(),
        [values.amountField]: line.amount.trim(),
        ...(line.discountValue.trim() && isNonZero(line.discountValue)
          ? { discountType: line.discountType, discountValue: line.discountValue.trim() }
          : { discountType: "NONE" }),
      })),
  };
}
