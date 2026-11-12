import { describe, expect, it } from "vitest";
import { buildConfirmPayload, isUsableGstin, isUsablePhone } from "@/features/bills/confirm-payload";
import type { ExtractedBill } from "@/lib/api/bills";

const emptyLine = {
  description: null,
  hsnCode: null,
  quantity: null,
  unit: null,
  unitPrice: null,
  discount: null,
  taxRate: null,
  lineTotal: null,
};

function bill(overrides: Partial<ExtractedBill> = {}): ExtractedBill {
  return {
    partyName: null,
    partyGstin: null,
    partyPhone: null,
    partyAddress: null,
    invoiceNumber: "INV-1",
    invoiceDate: "2026-09-22",
    subtotal: null,
    totalTax: null,
    totalDiscount: null,
    grandTotal: null,
    amountPaid: null,
    balanceDue: null,
    lines: [],
    confidence: null,
    notes: null,
    ...overrides,
  };
}

describe("buildConfirmPayload", () => {
  it("records matched lines and leaves unticked unmatched ones out", () => {
    const payload = buildConfirmPayload({
      data: bill({
        lines: [
          { ...emptyLine, description: "Rice 5kg", quantity: "2", unitPrice: "420" },
          { ...emptyLine, description: "Something unreadable", quantity: "1" },
        ],
      }),
      direction: "IN",
      partyId: "supplier-1",
      warehouseId: "wh-1",
      lineProductIds: ["product-1", ""],
      createLine: [false, false],
      createParty: false,
    });

    expect(payload.document.items).toEqual([
      { productId: "product-1", quantity: "2", unitCost: "420" },
    ]);
    expect(payload.newProducts).toEqual([]);
    expect(payload.newParty).toBeNull();
    expect(payload.document.supplierId).toBe("supplier-1");
  });

  it("adds no discount to a bill that has none", () => {
    const payload = buildConfirmPayload({
      data: bill({
        lines: [{ ...emptyLine, description: "Rice 5kg", quantity: "2", unitPrice: "420" }],
      }),
      direction: "IN",
      partyId: "supplier-1",
      warehouseId: "wh-1",
      lineProductIds: ["p1"],
      createLine: [false],
      createParty: false,
    });
    expect(payload.document.items).toEqual([{ productId: "p1", quantity: "2", unitCost: "420" }]);
  });

  it("keeps a discount printed against a single line", () => {
    const payload = buildConfirmPayload({
      data: bill({
        lines: [{ ...emptyLine, description: "Rice 5kg", quantity: "2", unitPrice: "420", discount: "40" }],
      }),
      direction: "IN",
      partyId: "supplier-1",
      warehouseId: "wh-1",
      lineProductIds: ["p1"],
      createLine: [false],
      createParty: false,
    });
    expect(payload.document.items).toEqual([
      { productId: "p1", quantity: "2", unitCost: "420", discountType: "FIXED", discountValue: "40.00" },
    ]);
  });

  it("spreads a bill-level discount across the recorded lines, to the paisa", () => {
    const payload = buildConfirmPayload({
      data: bill({
        totalDiscount: "50",
        lines: [
          { ...emptyLine, description: "Sunflower Oil 1L", quantity: "5", unitPrice: "140" },
          { ...emptyLine, description: "Dove Soap 100g", quantity: "4", unitPrice: "55" },
          { ...emptyLine, description: "Maggi Noodles 70g", quantity: "10", unitPrice: "14" },
          { ...emptyLine, description: "Coca-Cola 750ml", quantity: "2", unitPrice: "45" },
        ],
      }),
      direction: "IN",
      partyId: "supplier-1",
      warehouseId: "wh-1",
      lineProductIds: ["p1", "p2", "p3", "p4"],
      createLine: [false, false, false, false],
      createParty: false,
    });
    const items = payload.document.items as Array<{ discountType?: string; discountValue?: string }>;
    // 50 spread by value over 700/220/140/90; the biggest line takes the rounding paise.
    expect(items.map((i) => i.discountValue)).toEqual(["30.45", "9.56", "6.08", "3.91"]);
    expect(items.every((i) => i.discountType === "FIXED")).toBe(true);
    const total = items.reduce((sum, i) => sum + Number(i.discountValue), 0);
    expect(total).toBeCloseTo(50, 2);
  });

  it("points each new product at its own item, even when earlier lines are skipped", () => {
    const payload = buildConfirmPayload({
      data: bill({
        lines: [
          { ...emptyLine, description: "Skipped line", quantity: "9" },
          { ...emptyLine, description: "Rice 5kg", quantity: "2", unitPrice: "420" },
          { ...emptyLine, description: "Mustard Oil 1L", quantity: "3", unit: "L", unitPrice: "165" },
        ],
      }),
      direction: "IN",
      partyId: "supplier-1",
      warehouseId: "wh-1",
      lineProductIds: ["", "product-rice", ""],
      // The first line is not matched and not ticked, so it is not recorded.
      createLine: [false, false, true],
      createParty: false,
    });

    // Two items: the matched rice, then the oil about to be created.
    expect(payload.document.items).toEqual([
      { productId: "product-rice", quantity: "2", unitCost: "420" },
      { quantity: "3", unitCost: "165" },
    ]);
    expect(payload.newProducts).toEqual([
      { index: 1, name: "Mustard Oil 1L", unit: "L", price: "165" },
    ]);
  });

  it("sends a new party only when none is chosen and it is ticked", () => {
    const args = {
      data: bill({
        partyName: "Verma Wholesale",
        partyPhone: "98123 45678",
        partyGstin: "19ABCDE1234F1Z5",
        partyAddress: "Main Road, Raipur",
        lines: [{ ...emptyLine, description: "Rice", quantity: "1" }],
      }),
      direction: "IN" as const,
      warehouseId: "wh-1",
      lineProductIds: ["product-1"],
      createLine: [false],
    };

    const created = buildConfirmPayload({ ...args, partyId: "", createParty: true });
    expect(created.newParty).toEqual({
      name: "Verma Wholesale",
      phone: "98123 45678",
      gstin: "19ABCDE1234F1Z5",
      address: "Main Road, Raipur",
    });
    expect(created.document.supplierId).toBeUndefined();

    const chosen = buildConfirmPayload({ ...args, partyId: "supplier-9", createParty: true });
    expect(chosen.newParty).toBeNull();
    expect(chosen.document.supplierId).toBe("supplier-9");

    const declined = buildConfirmPayload({ ...args, partyId: "", createParty: false });
    expect(declined.newParty).toBeNull();
  });

  it("drops the rubbish a handwritten bill yields instead of sending it as a GSTIN or phone", () => {
    const payload = buildConfirmPayload({
      data: bill({
        partyName: "Corner Shop",
        partyGstin: ".",
        partyPhone: "-",
        partyAddress: "..",
        lines: [{ ...emptyLine, description: "Sugar", quantity: "1" }],
      }),
      direction: "IN",
      partyId: "",
      warehouseId: "wh-1",
      lineProductIds: [""],
      createLine: [true],
      createParty: true,
    });

    expect(payload.newParty).toEqual({ name: "Corner Shop" });
  });

  it("uses sale wording and the customer field for an outgoing bill", () => {
    const payload = buildConfirmPayload({
      data: bill({ lines: [{ ...emptyLine, description: "Rice", quantity: "2", unitPrice: "50" }] }),
      direction: "OUT",
      partyId: "customer-1",
      warehouseId: "wh-1",
      lineProductIds: ["product-1"],
      createLine: [false],
      createParty: false,
    });

    expect(payload.document.customerId).toBe("customer-1");
    expect(payload.document.items).toEqual([
      { productId: "product-1", quantity: "2", unitPrice: "50" },
    ]);
  });
});

describe("which store the stock goes to", () => {
  const base = {
    data: bill({ lines: [{ ...emptyLine, description: "Rice", quantity: "1", unitPrice: "40" }] }),
    direction: "IN" as const,
    partyId: "supplier-1",
    lineProductIds: ["product-1"],
    createLine: [false],
    createParty: false,
  };

  it("sends the chosen store and asks for nothing new", () => {
    const payload = buildConfirmPayload({
      ...base,
      warehouseId: "wh-1",
      newWarehouse: { name: "Main Store" },
    });

    expect(payload.document.warehouseId).toBe("wh-1");
    // A store was picked, so nothing is created even if one was offered.
    expect(payload.newWarehouse).toBeNull();
  });

  it("leaves the store out entirely when none is chosen, so the server resolves it", () => {
    const payload = buildConfirmPayload({ ...base, warehouseId: "" });

    expect("warehouseId" in payload.document).toBe(false);
    expect(payload.newWarehouse).toBeNull();
  });

  it("asks for a first store to be created when the shop has none", () => {
    const payload = buildConfirmPayload({
      ...base,
      warehouseId: "",
      newWarehouse: { name: "Main Store" },
    });

    expect("warehouseId" in payload.document).toBe(false);
    expect(payload.newWarehouse).toEqual({ name: "Main Store" });
  });
});

describe("field sanity checks", () => {
  it("accepts a real GSTIN and rejects anything else", () => {
    expect(isUsableGstin("19ABCDE1234F1Z5")).toBe(true);
    expect(isUsableGstin(".")).toBe(false);
    expect(isUsableGstin("19ABCDE1234F1Z")).toBe(false);
    expect(isUsableGstin(null)).toBe(false);
  });

  it("accepts a ten-digit phone however it is punctuated", () => {
    expect(isUsablePhone("+91 98765 43210")).toBe(true);
    expect(isUsablePhone("9876543210")).toBe(true);
    expect(isUsablePhone("12345")).toBe(false);
    expect(isUsablePhone("-")).toBe(false);
  });
});
