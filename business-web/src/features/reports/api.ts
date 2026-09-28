import { getOne, type ListParams } from "@/lib/api";
import type { CreditList, Period } from "@/lib/api";

/**
 * Report shapes the shared API layer leaves as Record<string, unknown>.
 *
 * Each interface below was read off the Express service that builds the
 * response (backend/src/modules/reports/*, accounting/report.service.js,
 * tax/*). Nothing is calculated here: every money value is the backend's own
 * string, and the screens only format it.
 */

// --- payments received / paid ------------------------------------------------

export interface PaymentMethodRow {
  method: string;
  count: number;
  amount: string;
}

export interface PaymentsReceivedReport {
  period: Period;
  receipts: {
    id: string;
    receiptNumber: string;
    date: string;
    customer: { id: string; name: string } | null;
    amount: string;
    againstInvoices: string;
    advance: string;
    method: string;
    reference: string | null;
  }[];
  byMethod: PaymentMethodRow[];
  totals: { receiptCount: number; amount: string; againstInvoices: string; advance: string };
}

export interface SupplierPaymentsReport {
  period: Period;
  payments: {
    id: string;
    paymentNumber: string;
    date: string;
    supplier: { id: string; name: string } | null;
    amount: string;
    againstBills: string;
    advance: string;
    method: string;
    reference: string | null;
  }[];
  byMethod: PaymentMethodRow[];
  totals: { paymentCount: number; amount: string; againstBills: string; advance: string };
}

// --- expenses ---------------------------------------------------------------

export interface ExpenseReport {
  period: Period;
  basis: { countedStatus: string; description: string };
  totals: {
    totalExpenses: string;
    expenseCount: number;
    largestCategory: { category: string; amount: string } | null;
  };
  byCategory: { accountId: string; category: string; expenseCount: number; amount: string }[];
  byPaymentMode: { paymentMode: string; expenseCount: number; amount: string }[];
  byPaymentAccount: { accountId: string; account: string; expenseCount: number; amount: string }[];
  byDate: { date: string; expenseCount: number; amount: string }[];
  otherStatuses: { status: string; reason: string; count: number; amount: string }[];
  note?: string;
}

// --- profit & loss / balance sheet -------------------------------------------

export interface StatementAccountRow {
  accountId: string;
  code: string;
  name: string;
  type: string;
  debit: string;
  credit: string;
  balance: string;
}

export interface StatementBlock {
  accounts: StatementAccountRow[];
  total: string;
}

export interface ProfitLossReport {
  fromDate: string | null;
  toDate: string | null;
  revenue: StatementBlock;
  salesReturns: StatementBlock;
  netRevenue: string;
  costOfGoodsSold: StatementBlock;
  grossProfit: string;
  otherExpenses: StatementBlock;
  netProfit: string;
}

export interface BalanceSheet {
  asOfDate: string | null;
  assets: StatementBlock;
  liabilities: StatementBlock;
  equity: StatementBlock & { capital: string; retainedEarnings: string };
  totalAssets: string;
  totalLiabilitiesAndEquity: string;
  difference: string;
  isBalanced: boolean;
}

// --- GST --------------------------------------------------------------------

export interface TaxTotals {
  taxableAmount: string;
  cgst: string;
  sgst: string;
  igst: string;
  cess: string;
  totalTax: string;
}

export interface GstDirection extends TaxTotals {
  byRate: (TaxTotals & { taxRate: string })[];
}

export interface GstSummary {
  fromDate: string | null;
  toDate: string | null;
  outputTax: GstDirection;
  inputTax: GstDirection;
  net: { cgst: string; sgst: string; igst: string; cess: string; netTax: string; position: "PAYABLE" | "CREDIT" };
  note?: string;
}

export interface HsnSummary {
  rows: (TaxTotals & { hsn: string | null })[];
  note?: string;
}

export interface Gstr1 {
  b2b: { description: string; totals: TaxTotals };
  b2c: { description: string; totals: TaxTotals; byPlaceOfSupplyAndRate: (TaxTotals & Record<string, unknown>)[] };
  creditNotes: { description: string; totals: TaxTotals };
  nilRatedExemptZeroRated: { description: string; totals: TaxTotals };
  hsnSummary: {
    description: string;
    rows: (TaxTotals & { hsn: string | null; description?: string | null; taxRate?: string })[];
    totals: TaxTotals;
  };
  rateSummary: { description: string; rows: (TaxTotals & { taxRate?: string })[]; totals: TaxTotals };
  documentsIssued?: {
    rows: { documentType: string; from: string | null; to: string | null; totalIssued: number; cancelled: number; net: number }[];
  };
  unclassified?: { description: string; totals: TaxTotals };
  totals: { invoices: TaxTotals; creditNotes: TaxTotals; net: TaxTotals; invoiceCount: number; creditNoteCount: number };
  notFiled?: string;
}

export interface Gstr3b {
  outwardSupplies: {
    taxableSupplies: TaxTotals & { label: string };
    nilRatedExemptSupplies: TaxTotals & { label: string };
    totals: TaxTotals;
  };
  inputTaxCredit: {
    allOtherItc: TaxTotals & { label: string };
    itcReversed: TaxTotals & { label: string };
    netItcAvailable: TaxTotals & { label: string };
  };
  netPosition: TaxTotals & { position: "PAYABLE" | "CREDIT"; description?: string };
  unclassified?: { description: string; documentCount: number; totals: TaxTotals };
  notFiled?: string;
}

// --- calls ------------------------------------------------------------------

export interface ReportRange {
  fromDate?: string;
  toDate?: string;
}

/**
 * Only the calls whose shared wrapper does not already say enough. The
 * outstanding reports take overdueOnly, which the shared reportsApi type does
 * not list, so they are wrapped here with it.
 */
export const reportCalls = {
  paymentsReceived: (p: ReportRange & ListParams & { customerId?: string }) =>
    getOne<PaymentsReceivedReport>("/reports/payments-received", "report", p),
  supplierPayments: (p: ReportRange & ListParams & { supplierId?: string }) =>
    getOne<SupplierPaymentsReport>("/reports/supplier-payments", "report", p),
  customerOutstanding: (p: { asOfDate?: string; overdueOnly?: boolean }) =>
    getOne<CreditList>("/reports/customer-outstanding", "report", {
      asOfDate: p.asOfDate,
      overdueOnly: p.overdueOnly ? "true" : undefined,
    }),
  supplierOutstanding: (p: { asOfDate?: string; overdueOnly?: boolean }) =>
    getOne<CreditList>("/reports/supplier-outstanding", "report", {
      asOfDate: p.asOfDate,
      overdueOnly: p.overdueOnly ? "true" : undefined,
    }),
  expenses: (p: ReportRange) => getOne<ExpenseReport>("/reports/expenses", "report", { ...p }),
  profitLoss: (p: ReportRange) => getOne<ProfitLossReport>("/reports/profit-loss", "report", { ...p }),
  balanceSheet: (p: { date?: string }) =>
    getOne<BalanceSheet>("/accounting/balance-sheet", "balanceSheet", { ...p }),
  gstSummary: (p: ReportRange) =>
    getOne<GstSummary>("/tax/gst-summary", "gstSummary", { dateFrom: p.fromDate, dateTo: p.toDate }),
  hsnSummary: (source: "SALES_INVOICE" | "PURCHASE", p: ReportRange) =>
    getOne<HsnSummary>(`/tax/hsn-summary/${source}`, "hsnSummary", {
      dateFrom: p.fromDate,
      dateTo: p.toDate,
    }),
  gstr1: (p: { fromDate: string; toDate: string }) => getOne<Gstr1>("/tax/returns/gstr-1", "gstr1", p),
  gstr3b: (p: { fromDate: string; toDate: string }) => getOne<Gstr3b>("/tax/returns/gstr-3b", "gstr3b", p),
};
