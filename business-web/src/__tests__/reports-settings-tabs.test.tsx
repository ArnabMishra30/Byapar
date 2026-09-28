import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// The report tabs and accountant tabs are UX mirrors of backend facts (is GST
// on? is this a shop owner?). These tests pin that a shop without GST never
// sees a tax tab and staff never see owner-only accountant pages.

const auth = { isGstEnabled: false, isAdmin: false };

vi.mock("@/lib/auth/auth-context", () => ({
  useAuth: () => auth,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/shop/reports/sales",
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { ReportTabs, periodLabel } from "@/features/reports/report-shell";
import { AccountingTabs } from "@/features/accounting/accounting-tabs";

describe("report tabs", () => {
  beforeEach(() => {
    auth.isGstEnabled = false;
    auth.isAdmin = false;
  });

  it("lists every report page and marks the current one", () => {
    render(<ReportTabs />);
    for (const label of ["Sales", "Purchases", "Stock", "Customers", "Suppliers", "Expenses", "Profit & Loss"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: "Sales" }).getAttribute("aria-current")).toBe("page");
  });

  it("hides the GST tab for a shop without GST", () => {
    render(<ReportTabs />);
    expect(screen.queryByRole("link", { name: "GST" })).toBeNull();
  });

  it("shows the GST tab once GST is on", () => {
    auth.isGstEnabled = true;
    render(<ReportTabs />);
    expect(screen.getByRole("link", { name: "GST" }).getAttribute("href")).toBe("/shop/reports/gst");
  });

  it("describes the period in plain words", () => {
    expect(periodLabel({})).toBe("All time");
    expect(periodLabel({ fromDate: "2026-09-01", toDate: "2026-09-28" })).toBe("2026/09/01 – 2026/09/28");
  });
});

describe("accountant tabs", () => {
  it("hides owner-only pages from staff", () => {
    render(<AccountingTabs />);
    expect(screen.getByRole("link", { name: "Accounts" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Periods" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Opening balance" })).toBeNull();
  });

  it("shows them to the shop owner", () => {
    auth.isAdmin = true;
    render(<AccountingTabs />);
    expect(screen.getByRole("link", { name: "Periods" })).toBeInTheDocument();
  });
});
