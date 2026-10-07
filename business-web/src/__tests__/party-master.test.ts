import { describe, expect, it } from "vitest";
import {
  EMPTY_PARTY_FORM,
  missingSides,
  toCreatePayload,
  toUpdatePayload,
  validatePartyForm,
} from "@/features/party-master/party-payload";
import { buildConfirmPayload } from "@/features/bills/confirm-payload";
import { NAVIGATION, ROUTES } from "@/lib/constants";
import type { ExtractedBill } from "@/lib/api/bills";

// The party master's client-side rules: what the form sends, what "use the
// existing party" still has to add, and how a bill confirms against a party
// that exists on the other side of the business.

describe("party form payload", () => {
  it("sends blanks as null and never sends a GSTIN nobody typed", () => {
    const payload = toCreatePayload({ ...EMPTY_PARTY_FORM, name: "  Rahul Store ", relationship: "CUSTOMER" });
    expect(payload).toMatchObject({ name: "Rahul Store", relationship: "CUSTOMER", phone: null, gstin: null });
    expect(payload).not.toHaveProperty("allowDuplicate");
  });

  it("sends each side's terms only to that side", () => {
    const values = {
      ...EMPTY_PARTY_FORM,
      name: "XYZ Traders",
      customerCreditDays: "15",
      customerCreditLimit: "50000",
      supplierCreditDays: "30",
    };
    expect(toCreatePayload({ ...values, relationship: "CUSTOMER" })).toMatchObject({
      customer: { creditDays: 15, creditLimit: "50000" },
    });
    expect(toCreatePayload({ ...values, relationship: "CUSTOMER" })).not.toHaveProperty("supplier");
    expect(toCreatePayload({ ...values, relationship: "BOTH" })).toMatchObject({
      customer: { creditDays: 15 },
      supplier: { creditDays: 30 },
    });
    expect(toUpdatePayload(values, { isCustomer: false, isSupplier: true })).not.toHaveProperty("customer");
  });

  it("only asks for allowDuplicate after the shop chose to create a new party", () => {
    expect(toCreatePayload({ ...EMPTY_PARTY_FORM, name: "Again" }, true)).toMatchObject({ allowDuplicate: true });
  });

  it("does not require a GSTIN, but checks one that is typed", () => {
    expect(validatePartyForm({ ...EMPTY_PARTY_FORM, name: "No Gst Shop" })).toEqual({});
    expect(validatePartyForm({ ...EMPTY_PARTY_FORM, name: "Shop", gstin: "123" }).gstin).toBeTruthy();
    expect(validatePartyForm({ ...EMPTY_PARTY_FORM, name: "x" }).name).toBeTruthy();
  });
});

describe("missingSides", () => {
  it("says what an existing party still needs", () => {
    expect(missingSides("SUPPLIER", "CUSTOMER")).toEqual(["SUPPLIER"]);
    expect(missingSides("BOTH", "SUPPLIER")).toEqual(["CUSTOMER"]);
    expect(missingSides("CUSTOMER", "BOTH")).toEqual([]);
  });
});

describe("bill confirm with an existing party on the other side", () => {
  const data: ExtractedBill = {
    partyName: "Rahul Store",
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
  };

  it("sends the chosen party instead of creating a new supplier", () => {
    const payload = buildConfirmPayload({
      data,
      direction: "IN",
      partyId: "",
      warehouseId: "w1",
      lineProductIds: [],
      createLine: [],
      createParty: true,
      linkParty: { partyId: "p1", name: "Rahul Store" },
    });
    expect(payload.newParty).toEqual({ name: "Rahul Store", partyId: "p1" });
    expect(payload.document).not.toHaveProperty("supplierId");
  });

  it("an explicitly chosen supplier wins over everything", () => {
    const payload = buildConfirmPayload({
      data,
      direction: "IN",
      partyId: "s1",
      warehouseId: "w1",
      lineProductIds: [],
      createLine: [],
      createParty: true,
      linkParty: { partyId: "p1", name: "Rahul Store" },
    });
    expect(payload.newParty).toBeNull();
    expect(payload.document).toMatchObject({ supplierId: "s1" });
  });
});

describe("navigation", () => {
  it("lists the Parties pages", () => {
    const hrefs = NAVIGATION.flatMap((section) => section.items.map((item) => item.href));
    expect(hrefs).toContain(ROUTES.parties);
    expect(hrefs).toContain(ROUTES.newParty);
  });
});

describe("bill confirm with a rack per line", () => {
  const line = (description: string) => ({
    description,
    hsnCode: null,
    quantity: "2",
    unit: null,
    unitPrice: "10",
    discount: null,
    taxRate: null,
    lineTotal: null,
  });
  const data: ExtractedBill = {
    partyName: null, partyGstin: null, partyPhone: null, partyAddress: null,
    invoiceNumber: "B-1", invoiceDate: "2026-09-22", subtotal: null, totalTax: null,
    totalDiscount: null, grandTotal: null, amountPaid: null, balanceDue: null,
    lines: [line("Rice"), line("Curd"), line("Skipped")],
    confidence: null, notes: null,
  };

  it("puts the rack on each item and on the new product, keeping indexes aligned", () => {
    const payload = buildConfirmPayload({
      data,
      direction: "IN",
      partyId: "s1",
      warehouseId: "w1",
      lineProductIds: ["p1", "", ""],
      lineLocationIds: ["rack1", "fridge", ""],
      createLine: [false, true, false],
      createParty: false,
    });
    const items = payload.document.items as Record<string, unknown>[];
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ productId: "p1", storageLocationId: "rack1" });
    expect(items[1]).toMatchObject({ storageLocationId: "fridge" });
    expect(payload.newProducts).toEqual([
      { index: 1, name: "Curd", unit: null, price: "10", storageLocationId: "fridge" },
    ]);
  });

  it("sends no rack when none is chosen, so the product's usual spot applies", () => {
    const payload = buildConfirmPayload({
      data: { ...data, lines: [line("Rice")] },
      direction: "OUT",
      partyId: "c1",
      warehouseId: "w1",
      lineProductIds: ["p1"],
      createLine: [false],
      createParty: false,
    });
    expect((payload.document.items as Record<string, unknown>[])[0]).not.toHaveProperty("storageLocationId");
  });
});
