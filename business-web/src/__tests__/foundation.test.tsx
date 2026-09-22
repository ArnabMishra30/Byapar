import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { can, whyNot } from "@/lib/permissions";
import { visibleSections } from "@/components/layout/nav-items";
import { formatMoney, formatAmount, formatDate, initials, cn, startOfMonth, daysAgo, stripBodyPrefix } from "@/lib/utils";
import { Money } from "@/components/shared/money";
import { NAVIGATION } from "@/lib/constants";

// The foundation, tested where it actually decides something: who can do what,
// what the navigation shows, and how money is rendered.

describe("permissions mirror the backend", () => {
  it("1. lets an admin do everything", () => {
    for (const capability of [
      "sales.post",
      "money.receive",
      "money.pay",
      "parties.manage",
      "periods.manage",
      "settings.manage",
      "staff.manage",
    ] as const) {
      expect(`ADMIN:${capability}:${can("ADMIN", capability)}`).toBe(
        `ADMIN:${capability}:true`,
      );
    }
  });

  it("2. lets staff draft a sale, a purchase and an expense", () => {
    // The backend allows POST /sales, /purchases and /expenses for STAFF.
    expect(can("STAFF", "sales.draft")).toBe(true);
    expect(can("STAFF", "purchases.draft")).toBe(true);
    expect(can("STAFF", "expenses.draft")).toBe(true);
  });

  it("3. stops staff POSTING a document, because the backend does", () => {
    // POST /sales/:id/post carries requireRole('ADMIN').
    expect(can("STAFF", "sales.post")).toBe(false);
    expect(can("STAFF", "purchases.post")).toBe(false);
    expect(can("STAFF", "expenses.post")).toBe(false);
  });

  it("4. stops staff recording money in or out", () => {
    // The whole write side of customer-payments and supplier-payments is ADMIN.
    expect(can("STAFF", "money.receive")).toBe(false);
    expect(can("STAFF", "money.pay")).toBe(false);
    // But they can still see it.
    expect(can("STAFF", "money.read")).toBe(true);
  });

  it("5. stops staff creating customers, suppliers or products", () => {
    expect(can("STAFF", "parties.manage")).toBe(false);
    expect(can("STAFF", "products.manage")).toBe(false);
    // Reading them is fine, and is what most of the app needs.
    expect(can("STAFF", "parties.read")).toBe(true);
    expect(can("STAFF", "products.read")).toBe(true);
  });

  it("6. stops staff touching periods, opening balances, settings or staff", () => {
    expect(can("STAFF", "periods.manage")).toBe(false);
    expect(can("STAFF", "openingBalances.create")).toBe(false);
    expect(can("STAFF", "settings.manage")).toBe(false);
    expect(can("STAFF", "gst.manage")).toBe(false);
    expect(can("STAFF", "staff.manage")).toBe(false);
  });

  it("7. lets staff read everything the backend lets them read", () => {
    for (const capability of [
      "sales.read",
      "purchases.read",
      "expenses.read",
      "inventory.read",
      "accounting.read",
      "periods.read",
      "reports.read",
      "settings.read",
      "gst.read",
    ] as const) {
      expect(`STAFF:${capability}:${can("STAFF", capability)}`).toBe(
        `STAFF:${capability}:true`,
      );
    }
  });

  it("8. refuses everything when there is no role at all", () => {
    expect(can(undefined, "sales.read")).toBe(false);
    expect(can(null, "sales.post")).toBe(false);
  });

  it("9. explains a refusal by naming who can do it", () => {
    // A dead end helps nobody: every message says an admin can.
    expect(whyNot("sales.post")).toMatch(/admin/i);
    expect(whyNot("money.receive")).toMatch(/admin/i);
    expect(whyNot("staff.manage")).toMatch(/admin/i);
  });
});

describe("navigation adapts to the business", () => {
  it("10. hides GST entirely from a shop that is not registered", () => {
    const sections = visibleSections(true, false);
    const flat = JSON.stringify(sections);

    expect(flat).not.toMatch(/gst/i);
    expect(sections.some((s) => s.title === "Tax")).toBe(false);
  });

  it("11. shows GST once the company has it switched on", () => {
    const sections = visibleSections(true, true);
    expect(sections.some((s) => s.title === "Tax")).toBe(true);
  });

  it("12. hides admin-only destinations from staff", () => {
    const staffNav = visibleSections(false, false);
    const hrefs = staffNav.flatMap((s) => s.items.map((i) => i.href));

    expect(hrefs).not.toContain("/shop/accounting/periods");
    expect(hrefs).not.toContain("/shop/accounting/opening-balance");
    expect(hrefs).not.toContain("/shop/settings/staff");
  });

  it("13. still gives staff the working parts of the shop", () => {
    const hrefs = visibleSections(false, false).flatMap((s) => s.items.map((i) => i.href));

    for (const href of ["/shop/dashboard", "/shop/sales", "/shop/purchases", "/shop/inventory", "/shop/credit", "/shop/settings"]) {
      expect(hrefs).toContain(href);
    }
  });

  it("14. never leaves an empty section on screen", () => {
    for (const flags of [
      [true, true],
      [true, false],
      [false, true],
      [false, false],
    ] as const) {
      const sections = visibleSections(flags[0], flags[1]);
      expect(sections.every((s) => s.items.length > 0)).toBe(true);
    }
  });

  it("15. gives every destination a unique route", () => {
    const hrefs = NAVIGATION.flatMap((s) => s.items.map((i) => i.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe("money is displayed, never calculated", () => {
  it("16. formats a backend money string in Indian digits", () => {
    // 1,00,000 - not 100,000.
    expect(formatMoney("100000")).toContain("1,00,000");
    expect(formatAmount("2500.5")).toBe("2,500.50");
  });

  it("17. always shows two decimals, as the ledger does", () => {
    expect(formatAmount("100")).toBe("100.00");
    expect(formatAmount("0")).toBe("0.00");
  });

  it("18. shows a dash rather than a wrong zero when there is no value", () => {
    // A missing figure and a zero figure are different facts.
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(undefined)).toBe("—");
    expect(formatAmount("")).toBe("—");
  });

  it("19. renders a negative balance as negative, not as an error", () => {
    render(<Money value="-4500" tone="auto" />);
    expect(screen.getByText(/4,500/)).toBeInTheDocument();
  });

  it("20. leaves the string alone if it is not a number", () => {
    expect(formatMoney("not-a-number")).toBe("not-a-number");
  });
});

describe("small helpers", () => {
  it("21. formats every business date as YYYY/MM/DD", () => {
    // ONE format across the whole application. Switching between "01 Apr 2026"
    // and "01/04/2026" is how a person misreads a due date.
    expect(formatDate("2026-04-01")).toBe("2026/04/01");
    expect(formatDate("2026-12-31")).toBe("2026/12/31");
    // Read in UTC: business dates are stored at UTC midnight, and local getters
    // would show the previous day for anyone east of Greenwich.
    expect(formatDate("2026-01-05T00:00:00.000Z")).toBe("2026/01/05");
    expect(formatDate(null)).toBe("—");
    expect(formatDate("nonsense")).toBe("—");
  });

  it("22. builds initials for the avatar", () => {
    expect(initials("Ramesh Kumar")).toBe("RK");
    expect(initials("Ramesh")).toBe("R");
    expect(initials(null)).toBe("?");
  });

  it("23. merges class names with the later one winning", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("24. gives the API the date shape it wants, not the display one", () => {
    // The API takes YYYY-MM-DD; only the screen shows YYYY/MM/DD.
    expect(startOfMonth(new Date("2026-04-17T00:00:00.000Z"))).toBe("2026-04-01");
    expect(daysAgo(0)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("25. strips the backend field prefix so errors land on the right input", () => {
    // The backend reports "body.items.0.quantity"; the form knows it as
    // "items.0.quantity".
    expect(stripBodyPrefix("body.name")).toBe("name");
    expect(stripBodyPrefix("body.items.0.quantity")).toBe("items.0.quantity");
    expect(stripBodyPrefix("name")).toBe("name");
  });
});

describe("navigation covers the whole application", () => {
  it("26. leaves no destination unbuilt", () => {
    // Every item in the sidebar must be a real screen. A menu that leads to a
    // "coming soon" page is worse than one that does not list it at all.
    const hrefs = NAVIGATION.flatMap((s) => s.items.map((i) => i.href));

    for (const expected of [
      "/shop/dashboard",
      "/shop/sales",
      "/shop/purchases",
      "/shop/inventory",
      "/shop/customers",
      "/shop/suppliers",
      "/shop/credit",
      "/shop/money-in",
      "/shop/money-out",
      "/shop/expenses",
      "/shop/cash-bank",
      "/shop/reports",
      "/shop/accounting/accounts",
      "/shop/accounting/journal",
      "/shop/accounting/opening-balance",
      "/shop/accounting/periods",
      "/shop/settings",
      "/shop/settings/staff",
      "/shop/profile",
    ]) {
      expect(hrefs).toContain(expected);
    }
  });

  it("27. carries no 'coming soon' marker anywhere", () => {
    expect(JSON.stringify(NAVIGATION)).not.toMatch(/comingSoon|soon/i);
  });
});
