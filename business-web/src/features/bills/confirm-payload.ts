import type { BillDirection, ExtractedBill } from "@/lib/api/bills";

// WHAT GETS SENT WHEN SOMEBODY CONFIRMS A BILL.
//
// Kept apart from the screen because it is the one piece of this feature with
// rules worth testing on their own: which lines are recorded, which records are
// about to be created, and - above all - that a product being created lines up
// with the right item of the document. Get that mapping wrong and a shop books
// rice against a tin of oil.

export interface NewParty {
  name: string;
  phone?: string;
  gstin?: string;
  address?: string;
}

export interface NewProduct {
  /** The position in document.items this product belongs to. */
  index: number;
  name: string;
  unit?: string | null;
  price?: string | null;
}

/** A store to create for a shop that has none. The server names it if we do not. */
export interface NewWarehouse {
  name: string;
}

/** Money that changed hands as the bill was recorded. */
export interface BillPayment {
  amount: string;
  method: "CASH" | "BANK_TRANSFER" | "UPI" | "CHEQUE" | "OTHER";
}

export interface ConfirmPayload {
  document: Record<string, unknown>;
  newParty: NewParty | null;
  newProducts: NewProduct[];
  newWarehouse: NewWarehouse | null;
  payment: BillPayment | null;
}

/** A GSTIN is 15 characters. Anything else read off a bill is noise, not a GSTIN. */
export function isUsableGstin(value: string | null | undefined): boolean {
  return /^[0-9A-Z]{15}$/i.test((value ?? "").trim());
}

/** Ten digits or more. A handwritten bill often yields "." or a stray dash. */
export function isUsablePhone(value: string | null | undefined): boolean {
  return (value ?? "").replace(/\D+/g, "").length >= 10;
}

/** An address worth keeping, rather than a smudge the reader guessed at. */
function usableText(value: string | null | undefined): string | undefined {
  const text = (value ?? "").trim();
  return text.length >= 3 ? text : undefined;
}

export interface BuildArgs {
  data: ExtractedBill;
  direction: BillDirection;
  /** The chosen supplier or customer, empty when none is chosen yet. */
  partyId: string;
  warehouseId: string;
  /** Chosen product per line, by line index. */
  lineProductIds: string[];
  /** Whether each unmatched line should be added as a new product. */
  createLine: boolean[];
  /** Whether an unmatched party should be added. */
  createParty: boolean;
  /**
   * The store to create, for a shop that has none yet.
   *
   * Left out when a store is chosen, or when the shop has one already: the
   * server uses the only store there is rather than asking about a decision
   * with one possible answer.
   */
  newWarehouse?: NewWarehouse | null;
  /**
   * What the shop says was paid on the spot.
   *
   * Sent only when it is a real amount: a bill entirely on credit sends nothing,
   * and neither does a blank or zero box, so no empty receipt is ever recorded.
   */
  payment?: { amount: string; method: BillPayment["method"] } | null;
}

/**
 * The document, plus anything that has to be created before it can be posted.
 *
 * A line is recorded when it is either matched to a product or ticked to be
 * added. Everything else is left out, exactly as the screen says it will be.
 */
export function buildConfirmPayload({
  data,
  direction,
  partyId,
  warehouseId,
  lineProductIds,
  createLine,
  createParty,
  newWarehouse = null,
  payment = null,
}: BuildArgs): ConfirmPayload {
  const isPurchase = direction === "IN";

  const included = data.lines
    .map((line, lineIndex) => ({ line, lineIndex }))
    .filter(({ line, lineIndex }) => {
      if (lineProductIds[lineIndex]) return true;
      return Boolean(createLine[lineIndex] && (line.description ?? "").trim());
    });

  const items = included.map(({ line, lineIndex }) => ({
    ...(lineProductIds[lineIndex] ? { productId: lineProductIds[lineIndex] } : {}),
    quantity: line.quantity ?? "0",
    ...(isPurchase ? { unitCost: line.unitPrice ?? "0" } : { unitPrice: line.unitPrice ?? "0" }),
  }));

  // THE MAPPING THAT MATTERS: the index is the item's position in the document,
  // not the line's position on the bill. Unmatched lines that were left out
  // shift everything after them.
  const newProducts: NewProduct[] = included
    .map(({ line, lineIndex }, itemIndex) => ({ line, lineIndex, itemIndex }))
    .filter(({ lineIndex }) => !lineProductIds[lineIndex])
    .map(({ line, itemIndex }) => ({
      index: itemIndex,
      name: (line.description ?? "").trim(),
      unit: line.unit ?? null,
      price: line.unitPrice ?? null,
    }));

  const partyName = (data.partyName ?? "").trim();
  const newParty: NewParty | null =
    !partyId && createParty && partyName
      ? {
          name: partyName,
          ...(isUsablePhone(data.partyPhone) ? { phone: data.partyPhone!.trim() } : {}),
          ...(isUsableGstin(data.partyGstin) ? { gstin: data.partyGstin!.trim().toUpperCase() } : {}),
          ...(usableText(data.partyAddress) ? { address: usableText(data.partyAddress) } : {}),
        }
      : null;

  const document: Record<string, unknown> = {
    // Left out entirely when no store is chosen: the server then uses the shop's
    // only store, or the one it is about to create.
    ...(warehouseId ? { warehouseId } : {}),
    invoiceDate: data.invoiceDate,
    items,
    ...(isPurchase
      ? { ...(partyId ? { supplierId: partyId } : {}), invoiceNumber: data.invoiceNumber }
      : { ...(partyId ? { customerId: partyId } : {}) }),
  };

  const paidAmount = Number((payment?.amount ?? "").replace(/[^\d.-]/g, ""));

  return {
    document,
    newParty,
    newProducts,
    newWarehouse: warehouseId ? null : newWarehouse,
    payment:
      payment && Number.isFinite(paidAmount) && paidAmount > 0
        ? { amount: payment.amount.trim(), method: payment.method }
        : null,
  };
}
