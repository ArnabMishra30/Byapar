import { describe, expect, it } from "vitest";
import {
  buildDocumentBody,
  emptyLine,
  fromDocument,
  fromPurchaseRegister,
  fromSalesRegister,
  isNonZero,
  isPositive,
  lineFromItem,
  parseTab,
  paymentStatusLabel,
  trimDecimal,
} from "@/features/documents/doc-helpers";
import { DOC_CONFIG } from "@/features/documents/config";
import type { PurchaseRegister, SalesRegister } from "@/lib/api/extended";

const pagination = { page: 1, limit: 20, total: 1, totalPages: 1 };

describe("documents: register rows keep the backend's figures", () => {
  it("maps a sales register row without touching paid or due", () => {
    const register = {
      period: { fromDate: null, toDate: null },
      pagination,
      invoices: [
        {
          id: "s1",
          invoiceNumber: "INV-1",
          invoiceDate: "2026-09-01",
          dueDate: null,
          customer: { id: "c1", name: "Ravi" },
          subtotal: "100.00",
          discount: "0.00",
          tax: "18.00",
          total: "118.00",
          paid: "18.00",
          outstanding: "100.00",
          paymentStatus: "PARTIALLY_PAID",
        },
      ],
      totals: { invoiceCount: 1, subtotal: "100.00", discount: "0.00", tax: "18.00", total: "118.00", netSales: "118.00" },
    } as SalesRegister;
    const page = fromSalesRegister(register);
    expect(page.rows[0]).toMatchObject({
      id: "s1",
      number: "INV-1",
      partyId: "c1",
      partyName: "Ravi",
      total: "118.00",
      paid: "18.00",
      due: "100.00",
      paymentStatus: "PARTIALLY_PAID",
      status: "POSTED",
    });
    expect(page.totals).toMatchObject({ count: 1, total: "118.00", net: "118.00" });
  });

  it("maps a purchase register row with the supplier's own bill number", () => {
    const register = {
      period: { fromDate: null, toDate: null },
      pagination,
      bills: [
        {
          id: "p1",
          purchaseNumber: "PUR-1",
          supplierInvoiceNumber: "SUP-77",
          invoiceDate: "2026-09-01",
          dueDate: null,
          supplier: { id: "sp", name: "Mehta Traders" },
          subtotal: "50.00",
          discount: "0.00",
          tax: "0.00",
          total: "50.00",
          paid: "0.00",
          outstanding: "50.00",
          paymentStatus: "OPEN",
        },
      ],
      totals: { billCount: 1, subtotal: "50.00", discount: "0.00", tax: "0.00", total: "50.00" },
    } as PurchaseRegister;
    const page = fromPurchaseRegister(register);
    expect(page.rows[0]).toMatchObject({ number: "PUR-1", supplierBillNumber: "SUP-77", due: "50.00" });
    expect(page.totals.count).toBe(1);
  });

  it("maps a draft without inventing paid or due", () => {
    const row = fromDocument("sale", {
      id: "d1",
      invoiceNumber: "",
      invoiceDate: "2026-09-02T00:00:00.000Z",
      status: "DRAFT",
      grandTotal: "10.00",
      customer: { id: "c1", name: "Ravi" },
    });
    expect(row.paid).toBeUndefined();
    expect(row.due).toBeUndefined();
    expect(row.status).toBe("DRAFT");
    expect(row.partyName).toBe("Ravi");
  });
});

describe("documents: small pure helpers", () => {
  it("labels payment status in shop words", () => {
    expect(paymentStatusLabel("OPEN")).toBe("Not paid");
    expect(paymentStatusLabel("PARTIALLY_PAID")).toBe("Part paid");
    expect(paymentStatusLabel("PAID")).toBe("Fully paid");
    expect(paymentStatusLabel(undefined)).toBe("—");
  });

  it("treats missing amounts as not due", () => {
    expect(isPositive("0.00")).toBe(false);
    expect(isPositive(undefined)).toBe(false);
    expect(isPositive("12.50")).toBe(true);
    expect(isNonZero("0.0000")).toBe(false);
    expect(isNonZero("-1")).toBe(true);
  });

  it("parses the list tab defensively", () => {
    expect(parseTab("drafts")).toBe("drafts");
    expect(parseTab("cancelled")).toBe("cancelled");
    expect(parseTab("anything")).toBe("completed");
    expect(parseTab(null)).toBe("completed");
  });

  it("trims backend decimals for editing", () => {
    expect(trimDecimal("2.000000")).toBe("2");
    expect(trimDecimal("12.5000")).toBe("12.5");
    expect(trimDecimal("100")).toBe("100");
  });
});

describe("documents: the draft body", () => {
  it("round-trips a saved line and keeps its tax and discount type", () => {
    const line = lineFromItem(
      {
        productId: "prod",
        productNameSnapshot: "Rice",
        quantity: "2.000000",
        unitPrice: "40.0000",
        discountType: "PERCENTAGE",
        discountValue: "5.0000",
        taxId: "tax-5",
      },
      "unitPrice",
    );
    const body = buildDocumentBody({
      partyField: "customerId",
      partyId: "c1",
      warehouseId: "w1",
      date: "2026-09-02",
      dueDate: "",
      notes: "  ",
      amountField: "unitPrice",
      lines: [line, emptyLine()],
    });
    expect(body).toMatchObject({ customerId: "c1", warehouseId: "w1", invoiceDate: "2026-09-02", dueDate: null, notes: null });
    expect(body.items).toEqual([
      { productId: "prod", taxId: "tax-5", quantity: "2", unitPrice: "40", discountType: "PERCENTAGE", discountValue: "5" },
    ]);
    // Only the server works out totals: nothing like a total is sent.
    expect(body).not.toHaveProperty("grandTotal");
  });

  it("sends the supplier bill number for purchases and no discount when blank", () => {
    const body = buildDocumentBody({
      partyField: "supplierId",
      partyId: "s1",
      warehouseId: "w1",
      date: "2026-09-02",
      dueDate: "2026-09-30",
      notes: "",
      amountField: "unitCost",
      supplierInvoiceNumber: " B-9 ",
      lines: [{ ...emptyLine(), productId: "p", quantity: "3", amount: "10" }],
    });
    expect(body).toMatchObject({ supplierId: "s1", invoiceNumber: "B-9", dueDate: "2026-09-30" });
    expect(body.items).toEqual([{ productId: "p", quantity: "3", unitCost: "10", discountType: "NONE" }]);
  });
});

describe("documents: routes follow the shared route map", () => {
  it("builds cross-links with the agreed query params", () => {
    expect(DOC_CONFIG.sale.paymentHref("c1")).toBe("/shop/money/received?customerId=c1");
    expect(DOC_CONFIG.purchase.paymentHref("s1")).toBe("/shop/money/paid?supplierId=s1");
    expect(DOC_CONFIG.sale.returnHref("x")).toBe("/shop/sales/returns/new?salesInvoiceId=x");
    expect(DOC_CONFIG.purchase.returnHref("y")).toBe("/shop/purchases/returns/new?purchaseId=y");
    expect(DOC_CONFIG.sale.editHref("x")).toBe("/shop/sales/x/edit");
    expect(DOC_CONFIG.purchase.listHref).toBe("/shop/purchases/bills");
  });
});
