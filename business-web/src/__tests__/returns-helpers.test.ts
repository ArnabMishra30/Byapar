import { describe, it, expect } from "vitest";
import {
  buildReturnReason,
  checkReturnQuantity,
  daysFromToday,
  daysPastDue,
  describeDue,
  formatQuantity,
  hasRemaining,
  toThousandths,
} from "@/features/returns/helpers";

describe("return quantity checks", () => {
  it("reads quantities as whole thousandths", () => {
    expect(toThousandths("1.5")).toBe(1500);
    expect(toThousandths("1.500")).toBe(1500);
    expect(toThousandths("0.001")).toBe(1);
    expect(toThousandths("12")).toBe(12000);
    expect(toThousandths("1.2345")).toBeNull();
    expect(toThousandths("-1")).toBeNull();
    expect(toThousandths("abc")).toBeNull();
  });

  it("treats empty and zero as 'not returning this line'", () => {
    expect(checkReturnQuantity("", "5.000")).toEqual({ ok: true, skip: true });
    expect(checkReturnQuantity("  ", "5.000")).toEqual({ ok: true, skip: true });
    expect(checkReturnQuantity("0", "5.000")).toEqual({ ok: true, skip: true });
    expect(checkReturnQuantity("0.000", "5.000")).toEqual({ ok: true, skip: true });
  });

  it("accepts up to the remaining quantity, inclusive", () => {
    expect(checkReturnQuantity("5", "5.000")).toEqual({ ok: true, skip: false, quantity: "5" });
    expect(checkReturnQuantity("2.25", "2.250")).toEqual({ ok: true, skip: false, quantity: "2.25" });
  });

  it("refuses more than remaining, and names the limit", () => {
    const result = checkReturnQuantity("5.001", "5.000");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("5");
  });

  it("refuses bad formats and more than 3 decimals", () => {
    expect(checkReturnQuantity("1.2345", "5").ok).toBe(false);
    expect(checkReturnQuantity("-1", "5").ok).toBe(false);
    expect(checkReturnQuantity("1,5", "5").ok).toBe(false);
  });

  it("knows when a line has nothing left", () => {
    expect(hasRemaining("0.000")).toBe(false);
    expect(hasRemaining("0.001")).toBe(true);
  });

  it("formats quantities without trailing zeros", () => {
    expect(formatQuantity("5.000")).toBe("5");
    expect(formatQuantity("2.500")).toBe("2.5");
    expect(formatQuantity("10")).toBe("10");
    expect(formatQuantity(null)).toBe("—");
  });
});

describe("return reason", () => {
  it("combines the picked reason with the detail", () => {
    expect(buildReturnReason("Damaged", "")).toBe("Damaged");
    expect(buildReturnReason("Damaged", "box torn")).toBe("Damaged: box torn");
    expect(buildReturnReason("Other", "size too small")).toBe("size too small");
    expect(buildReturnReason("", "just text")).toBe("just text");
    expect(buildReturnReason("", "")).toBeUndefined();
    expect(buildReturnReason("Other", "")).toBe("Other");
  });

  it("never exceeds the backend's 200 character limit", () => {
    expect(buildReturnReason("Damaged", "x".repeat(300))!.length).toBeLessThanOrEqual(200);
  });
});

describe("due dates", () => {
  const today = new Date("2026-09-28T15:00:00.000Z");

  it("counts whole days past the due date", () => {
    expect(daysPastDue("2026-09-18", today)).toBe(10);
    expect(daysPastDue("2026-09-28", today)).toBe(0);
    expect(daysPastDue("2026-10-01", today)).toBe(-3);
    expect(daysPastDue(null, today)).toBeNull();
    expect(daysPastDue("not a date", today)).toBeNull();
  });

  it("describes the due position in plain words", () => {
    expect(describeDue(null)).toBe("No due date");
    expect(describeDue(0)).toBe("Due today");
    expect(describeDue(-1)).toBe("Due in 1 day");
    expect(describeDue(-3)).toBe("Due in 3 days");
    expect(describeDue(1)).toBe("1 day late");
    expect(describeDue(12)).toBe("12 days late");
  });

  it("builds due-date cut-offs relative to today", () => {
    expect(daysFromToday(0, today)).toBe("2026-09-28");
    expect(daysFromToday(-1, today)).toBe("2026-09-27");
    expect(daysFromToday(7, today)).toBe("2026-10-05");
  });
});
