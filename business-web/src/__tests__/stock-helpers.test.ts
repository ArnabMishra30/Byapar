import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  ADJUSTMENT_REASONS,
  NOTES_MAX,
  adjustmentTypeFor,
  formatAdjustmentNotes,
  formatQuantity,
  isInward,
  isOutOfStock,
  movementLabel,
  movementReference,
  stockLevel,
  todayRange,
} from "@/features/stock/stock-helpers";

describe("stock movement labels", () => {
  it("names every backend movement type in shop words", () => {
    expect(movementLabel("OPENING_STOCK")).toBe("Opening stock");
    expect(movementLabel("STOCK_IN")).toBe("Stock in (purchase)");
    expect(movementLabel("STOCK_OUT")).toBe("Stock out (sale)");
    expect(movementLabel("ADJUSTMENT_IN")).toBe("Added (adjustment)");
    expect(movementLabel("ADJUSTMENT_OUT")).toBe("Removed (adjustment)");
  });

  it("falls back to the raw type rather than hiding an unknown one", () => {
    expect(movementLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
    expect(movementLabel(null)).toBe("—");
  });

  it("knows which movements add stock", () => {
    expect(isInward("OPENING_STOCK")).toBe(true);
    expect(isInward("STOCK_IN")).toBe(true);
    expect(isInward("ADJUSTMENT_IN")).toBe(true);
    expect(isInward("STOCK_OUT")).toBe(false);
    expect(isInward("ADJUSTMENT_OUT")).toBe(false);
  });
});

describe("movement references link to the document", () => {
  it("links sales, purchases and returns", () => {
    expect(movementReference("SALES_INVOICE", "s1").href).toBe("/shop/sales/s1");
    expect(movementReference("PURCHASE", "p1").href).toBe("/shop/purchases/p1");
    expect(movementReference("SALES_RETURN", "r1").href).toBe("/shop/sales/returns/r1");
    expect(movementReference("PURCHASE_RETURN", "r2").href).toBe("/shop/purchases/returns/r2");
  });

  it("gives opening stock and adjustments a label but no link", () => {
    expect(movementReference("OPENING_STOCK", "x")).toEqual({ label: "Opening stock" });
    expect(movementReference("STOCK_ADJUSTMENT", "x")).toEqual({ label: "Adjustment" });
  });

  it("does not build a link without an id", () => {
    expect(movementReference("SALES_INVOICE", null).href).toBeUndefined();
  });
});

describe("adjustment reason decides the direction", () => {
  it("removes stock for damaged, lost and expired", () => {
    expect(adjustmentTypeFor("DAMAGED")).toBe("ADJUSTMENT_OUT");
    expect(adjustmentTypeFor("LOST")).toBe("ADJUSTMENT_OUT");
    expect(adjustmentTypeFor("EXPIRED")).toBe("ADJUSTMENT_OUT");
  });

  it("adds stock for found, whatever was chosen", () => {
    expect(adjustmentTypeFor("FOUND")).toBe("ADJUSTMENT_IN");
    expect(adjustmentTypeFor("FOUND", "ADJUSTMENT_OUT")).toBe("ADJUSTMENT_IN");
  });

  it("lets the shopkeeper choose for a count difference or other, and never guesses", () => {
    expect(adjustmentTypeFor("COUNT")).toBeNull();
    expect(adjustmentTypeFor("COUNT", "ADJUSTMENT_IN")).toBe("ADJUSTMENT_IN");
    expect(adjustmentTypeFor("OTHER", "ADJUSTMENT_OUT")).toBe("ADJUSTMENT_OUT");
    expect(adjustmentTypeFor("")).toBeNull();
  });

  it("offers every reason exactly once", () => {
    const values = ADJUSTMENT_REASONS.map((r) => r.value);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("adjustment notes carry the reason", () => {
  it("puts the reason in front of the notes", () => {
    expect(formatAdjustmentNotes("DAMAGED", "box fell")).toBe("Damaged: box fell");
  });

  it("stores the reason alone when there are no notes", () => {
    expect(formatAdjustmentNotes("EXPIRED", "   ")).toBe("Expired");
  });

  it("sends nothing when there is neither", () => {
    expect(formatAdjustmentNotes("", "")).toBeUndefined();
  });

  it("stays within the backend's 500 character limit", () => {
    expect(formatAdjustmentNotes("OTHER", "x".repeat(600))?.length).toBe(NOTES_MAX);
  });
});

describe("stock level badge", () => {
  it("is out at zero or below", () => {
    expect(stockLevel("0.000", "5")).toBe("out");
    expect(stockLevel("-2", "5")).toBe("out");
    expect(isOutOfStock("0")).toBe(true);
  });

  it("is low at or below the minimum level", () => {
    expect(stockLevel("5", "5")).toBe("low");
    expect(stockLevel("3", "5.000")).toBe("low");
  });

  it("is never low without a minimum level", () => {
    expect(stockLevel("1", "0")).toBe("ok");
    expect(stockLevel("1", null)).toBe("ok");
  });
});

describe("display helpers", () => {
  it("formats quantities without padding zeros", () => {
    expect(formatQuantity("12.000")).toBe("12");
    expect(formatQuantity("2.500")).toBe("2.5");
    expect(formatQuantity(null)).toBe("—");
  });

  it("builds a same-day range for today's entries", () => {
    const { fromDate, toDate } = todayRange(new Date(2026, 8, 28, 15, 0));
    expect(new Date(fromDate).getTime()).toBeLessThan(new Date(toDate).getTime());
    expect(new Date(toDate).getTime() - new Date(fromDate).getTime()).toBeLessThan(24 * 3600 * 1000);
  });
});

describe("stock screens never add up money or quantities", () => {
  it("has no reduce() in the stock or product features", () => {
    const root = path.resolve(__dirname, "..", "features");
    for (const dir of ["stock", "products"]) {
      for (const file of fs.readdirSync(path.join(root, dir))) {
        const text = fs.readFileSync(path.join(root, dir, file), "utf8");
        expect(`${dir}/${file}:${/\.reduce\(/.test(text)}`).toBe(`${dir}/${file}:false`);
      }
    }
  });
});
