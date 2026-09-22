import { describe, it, expect } from "vitest";
import {
  bestValuePlanId,
  formatRupees,
  monthlyPrice,
  monthsIn,
  planSlug,
} from "@/features/landing/plan-format";
import type { PublicPlan } from "@/lib/api/public";

// The pricing DISPLAY helpers. Nothing here charges anyone - the backend does
// that in Decimal - but a wrong badge or a mangled price is still a wrong claim
// on a public page.

function plan(overrides: Partial<PublicPlan>): PublicPlan {
  return {
    id: "id",
    name: "Plan",
    description: null,
    price: "0",
    currency: "INR",
    durationValue: 1,
    durationUnit: "MONTH",
    durationLabel: "1 month",
    ...overrides,
  };
}

describe("formatRupees", () => {
  it("drops .00 from whole amounts", () => {
    expect(formatRupees("300.00")).toBe("₹300");
    expect(formatRupees("500.0000")).toBe("₹500");
  });

  it("keeps two decimals when there are paise", () => {
    expect(formatRupees("1999.5")).toBe("₹1,999.50");
  });

  it("uses Indian digit grouping", () => {
    expect(formatRupees(150000)).toBe("₹1,50,000");
  });

  it("does not invent a number from nonsense", () => {
    expect(formatRupees("abc")).toBe("₹abc");
  });
});

describe("monthsIn and monthlyPrice", () => {
  it("reads months, years and days", () => {
    expect(monthsIn({ durationValue: 6, durationUnit: "MONTH" })).toBe(6);
    expect(monthsIn({ durationValue: 1, durationUnit: "YEAR" })).toBe(12);
    expect(monthsIn({ durationValue: 90, durationUnit: "DAY" })).toBe(3);
  });

  it("refuses a zero or negative duration", () => {
    expect(monthsIn({ durationValue: 0, durationUnit: "MONTH" })).toBeNull();
  });

  it("divides price by months", () => {
    expect(monthlyPrice(plan({ price: "500", durationValue: 6 }))).toBeCloseTo(83.33, 2);
  });

  it("has no monthly price for a plan shorter than a month", () => {
    expect(monthlyPrice(plan({ price: "50", durationValue: 14, durationUnit: "DAY" }))).toBeNull();
  });
});

describe("bestValuePlanId", () => {
  it("picks the lowest monthly rate", () => {
    const plans = [
      plan({ id: "three", price: "300", durationValue: 3 }),
      plan({ id: "six", price: "500", durationValue: 6 }),
    ];
    expect(bestValuePlanId(plans)).toBe("six");
  });

  it("gives no badge to a single plan", () => {
    expect(bestValuePlanId([plan({ id: "only", price: "300", durationValue: 3 })])).toBeNull();
  });

  it("gives no badge on a tie", () => {
    const plans = [
      plan({ id: "a", price: "300", durationValue: 3 }),
      plan({ id: "b", price: "600", durationValue: 6 }),
    ];
    expect(bestValuePlanId(plans)).toBeNull();
  });
});

describe("planSlug", () => {
  it("makes a readable URL parameter", () => {
    expect(planSlug({ name: "6 Months" })).toBe("6-months");
    expect(planSlug({ name: "  Annual Plan! " })).toBe("annual-plan");
  });
});
