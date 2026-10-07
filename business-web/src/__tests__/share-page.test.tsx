import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SharedPage } from "@/features/share/shared-page";
import { publicShareApi, sharePath, type SharedView } from "@/lib/api/share";

// The page a customer opens from a shared link: no login, read-only, and the
// figures exactly as the server sent them.

const view: SharedView = {
  kind: "INVOICE",
  shop: { name: "Demo Kirana Store", legalName: null, phone: "9800000000", email: null, city: "Pune", gstin: null },
  invoice: {
    id: "i1",
    invoiceNumber: "INV-0001",
    invoiceDate: "2026-09-02",
    dueDate: null,
    status: "POSTED",
    customerName: "Ravi Kirana",
    customerGstin: null,
    items: [
      { lineNumber: 1, name: "Basmati Rice", unit: "Bag", hsn: null, quantity: "2.000", unitPrice: "500.00", discount: "0.00", taxRate: null, tax: "0.00", total: "1000.00" },
    ],
    subtotal: "1000.00",
    discountTotal: "0.00",
    taxTotal: "0.00",
    taxBreakup: { cgst: "0.00", sgst: "0.00", igst: "0.00", cess: "0.00" },
    grandTotal: "1000.00",
    paid: "300.00",
    returned: "0.00",
    due: "700.00",
    notes: null,
  },
  account: {
    side: "CUSTOMER",
    partyName: "Ravi Kirana",
    lines: [
      { date: "2026-09-02", label: "Invoice", documentNumber: "INV-0001", invoiceId: "i1", reference: null, dueDate: null, debit: "1000.00", credit: "0.00", balance: "1000.00" },
      { date: "2026-09-03", label: "Receipt", documentNumber: null, invoiceId: null, reference: null, dueDate: null, debit: "0.00", credit: "300.00", balance: "700.00" },
    ],
    closingBalance: "700.00",
    totals: { totalDebit: "1000.00", totalCredit: "300.00", entryCount: 2 },
  },
  generatedAt: "2026-10-06T10:00:00.000Z",
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SharedPage token={"a".repeat(32)} />
    </QueryClientProvider>,
  );
}

describe("shared bill page", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows the shop, the bill, what is due and the log book", async () => {
    vi.spyOn(publicShareApi, "view").mockResolvedValue(view);
    renderPage();

    await waitFor(() => expect(screen.getByText("Demo Kirana Store")).toBeTruthy());
    expect(screen.getByText(/Invoice INV-0001/)).toBeTruthy();
    expect(screen.getByText("Balance due")).toBeTruthy();
    expect(screen.getByText("You owe")).toBeTruthy();
    expect(screen.getByText("Account of Ravi Kirana")).toBeTruthy();
  });

  it("says plainly when the link has been stopped", async () => {
    vi.spyOn(publicShareApi, "view").mockRejectedValue(new Error("404"));
    renderPage();
    await waitFor(() => expect(screen.getByText("This link is no longer available")).toBeTruthy());
  });

  it("builds the public path from the token", () => {
    expect(sharePath("abc")).toBe("/s/abc");
  });
});
