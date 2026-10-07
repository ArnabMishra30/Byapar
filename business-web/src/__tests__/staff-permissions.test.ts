import { describe, expect, it } from "vitest";
import { can } from "@/lib/permissions";
import { visibleSections } from "@/components/layout/nav-items";
import { ROUTES } from "@/lib/constants";

// The screens mirror the server's per-user permissions. UX only: the backend
// refuses the request regardless.

const CASHIER = ["SALES_CREATE", "SALES_POST", "SALES_DISCOUNT", "MONEY_RECEIVE", "SHARE_LINKS"];
const LEGACY = ["SALES_CREATE", "SALES_DISCOUNT", "SALES_VIEW_ALL", "REPORTS_VIEW", "LEGACY_DRAFTS"];

describe("can() with per-user permissions", () => {
  it("the owner can do everything", () => {
    expect(can("ADMIN", "staff.manage", [])).toBe(true);
  });

  it("a cashier completes sales and takes money, but sees no reports or purchases", () => {
    expect(can("STAFF", "sales.post", CASHIER)).toBe(true);
    expect(can("STAFF", "money.receive", CASHIER)).toBe(true);
    expect(can("STAFF", "share.create", CASHIER)).toBe(true);
    expect(can("STAFF", "reports.read", CASHIER)).toBe(false);
    expect(can("STAFF", "purchases.read", CASHIER)).toBe(false);
    expect(can("STAFF", "sales.cancel", CASHIER)).toBe(false);
    expect(can("STAFF", "settings.manage", CASHIER)).toBe(false);
  });

  it("an old staff account keeps the old abilities", () => {
    expect(can("STAFF", "sales.draft", LEGACY)).toBe(true);
    expect(can("STAFF", "sales.post", LEGACY)).toBe(false);
    expect(can("STAFF", "reports.read", LEGACY)).toBe(true);
    expect(can("STAFF", "salesReturns.draft", LEGACY)).toBe(true);
  });

  it("without permissions from the session, the old two-role rule applies", () => {
    expect(can("STAFF", "sales.draft")).toBe(true);
    expect(can("STAFF", "sales.post")).toBe(false);
  });
});

describe("navigation for a cashier", () => {
  it("hides reports, purchases and the credit book", () => {
    const hrefs = visibleSections(false, false, (cap) => can("STAFF", cap, CASHIER)).flatMap((s) =>
      s.items.map((i) => i.href),
    );
    expect(hrefs).toContain(ROUTES.quickBilling);
    expect(hrefs).toContain(ROUTES.moneyReceived);
    expect(hrefs).not.toContain(ROUTES.salesReport);
    expect(hrefs).not.toContain(ROUTES.purchases);
    expect(hrefs).not.toContain(ROUTES.creditBook);
    expect(hrefs).not.toContain(ROUTES.billerReport);
  });
});

describe("adding a customer while billing", () => {
  it("a cashier may add a customer but not edit customers or add suppliers", () => {
    const cashier = [...CASHIER, "CUSTOMERS_CREATE"];
    expect(can("STAFF", "customers.create", cashier)).toBe(true);
    expect(can("STAFF", "parties.manage", cashier)).toBe(false);
  });

  it("the owner and anyone who manages parties can too; an old staff account cannot", () => {
    expect(can("ADMIN", "customers.create", [])).toBe(true);
    expect(can("STAFF", "customers.create", ["PARTIES_MANAGE"])).toBe(true);
    expect(can("STAFF", "customers.create", LEGACY)).toBe(false);
  });
});
