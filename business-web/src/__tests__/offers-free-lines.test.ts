import { describe, expect, it } from "vitest";
import { buildDocumentBody, emptyLine, lineFromItem } from "@/features/documents/doc-helpers";

// Free lines on a sale: price 0, flagged free, and an offer's line carries its
// offerId so the server can work it out again instead of trusting it.

const base = {
  partyField: "customerId" as const,
  partyId: "c1",
  warehouseId: "w1",
  date: "2026-10-07",
  dueDate: "",
  notes: "",
  amountField: "unitPrice" as const,
};

describe("free sale lines", () => {
  it("a free line goes out at price 0 with no discount", () => {
    const body = buildDocumentBody({
      ...base,
      lines: [
        { ...emptyLine(), productId: "soap", quantity: "1", amount: "40" },
        { ...emptyLine(), productId: "soap", quantity: "1", amount: "40", isFree: true, discountValue: "5" },
      ],
    });
    const items = body.items as Record<string, unknown>[];
    expect(items[0]).toMatchObject({ productId: "soap", unitPrice: "40" });
    expect(items[0]).not.toHaveProperty("isFree");
    expect(items[1]).toMatchObject({ productId: "soap", unitPrice: "0", isFree: true, discountType: "NONE" });
  });

  it("a saved line from an offer keeps its offer, so the server recomputes it", () => {
    const line = lineFromItem(
      { productId: "brush", quantity: "2.000", unitPrice: "0.0000", isFree: true, offer: { id: "o1", name: "B1G1" } },
      "unitPrice",
    );
    expect(line).toMatchObject({ isFree: true, offerId: "o1", offerName: "B1G1" });
    const items = buildDocumentBody({ ...base, lines: [line] }).items as Record<string, unknown>[];
    expect(items[0]).toMatchObject({ isFree: true, offerId: "o1" });
  });
});
