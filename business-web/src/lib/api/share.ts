import axios from "axios";
import { apiClient } from "./client";
import { APP_CONFIG } from "@/lib/constants";
import type { ApiSuccessResponse } from "@/types/api";

// SHARE LINKS: a bill and/or a log book the shop sends to a customer or
// supplier, opened with no login.

export type ShareLinkKind = "INVOICE" | "CUSTOMER_ACCOUNT" | "SUPPLIER_ACCOUNT";

export interface ShareLink {
  id: string;
  kind: ShareLinkKind;
  token: string;
  salesInvoiceId: string | null;
  customerId: string | null;
  supplierId: string | null;
  includeAccount: boolean;
  isActive: boolean;
  createdAt: string;
  revokedAt: string | null;
  viewCount: number;
  firstViewedAt: string | null;
  lastViewedAt: string | null;
}

export type CreateShareLinkInput =
  | { kind: "INVOICE"; salesInvoiceId: string; includeAccount?: boolean }
  | { kind: "CUSTOMER_ACCOUNT"; customerId: string }
  | { kind: "SUPPLIER_ACCOUNT"; supplierId: string };

/** The owner side: signed-in, through the app's own client. */
export const shareLinksApi = {
  list: async (q: { salesInvoiceId?: string; customerId?: string; supplierId?: string }): Promise<ShareLink[]> => {
    const res = await apiClient.get<ApiSuccessResponse<{ links: ShareLink[] }>>("/share-links", { params: q });
    return res.data.data.links;
  },
  create: async (body: CreateShareLinkInput): Promise<ShareLink> => {
    const res = await apiClient.post<ApiSuccessResponse<{ link: ShareLink }>>("/share-links", body);
    return res.data.data.link;
  },
  revoke: async (id: string): Promise<ShareLink> => {
    const res = await apiClient.post<ApiSuccessResponse<{ link: ShareLink }>>(`/share-links/${id}/revoke`);
    return res.data.data.link;
  },
};

/** The page a link opens. Path only; the origin is added where it is shown. */
export const sharePath = (token: string) => `/s/${token}`;

// --- the recipient side ---------------------------------------------------------

export interface SharedInvoice {
  id: string;
  invoiceNumber: string | null;
  invoiceDate: string;
  dueDate: string | null;
  status: string;
  customerName: string;
  customerGstin: string | null;
  items: {
    lineNumber: number;
    name: string;
    unit: string | null;
    hsn: string | null;
    quantity: string;
    unitPrice: string;
    discount: string;
    taxRate: string | null;
    tax: string;
    total: string;
    /** Given free (an offer, or by the shop): price 0. */
    isFree?: boolean;
    /** A combo's contents (empty for an ordinary item). */
    contains?: { name: string; quantity: string }[];
  }[];
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  taxBreakup: { cgst: string; sgst: string; igst: string; cess: string };
  grandTotal: string;
  paid: string | null;
  returned: string | null;
  due: string | null;
  notes: string | null;
}

export interface SharedAccount {
  side: "CUSTOMER" | "SUPPLIER";
  partyName: string;
  lines: {
    date: string;
    label: string;
    documentNumber: string | null;
    invoiceId: string | null;
    reference: string | null;
    dueDate: string | null;
    debit: string;
    credit: string;
    balance: string;
  }[];
  closingBalance: string;
  totals: { totalDebit: string; totalCredit: string; entryCount: number };
}

export interface SharedView {
  kind: ShareLinkKind;
  shop: {
    name: string;
    legalName: string | null;
    phone: string | null;
    email: string | null;
    city: string | null;
    gstin: string | null;
  };
  invoice: SharedInvoice | null;
  account: SharedAccount | null;
  generatedAt: string;
}

// A bare client, not apiClient: the person opening a shared bill is not signed
// in, and must never be refreshed-at or redirected to a login screen.
const publicClient = axios.create({ baseURL: APP_CONFIG.apiUrl, timeout: 15000 });

export const publicShareApi = {
  view: async (token: string): Promise<SharedView> => {
    const res = await publicClient.get<ApiSuccessResponse<SharedView>>(`/public/share/${encodeURIComponent(token)}`);
    return res.data.data;
  },
  invoice: async (token: string, invoiceId: string): Promise<SharedInvoice> => {
    const res = await publicClient.get<ApiSuccessResponse<{ invoice: SharedInvoice }>>(
      `/public/share/${encodeURIComponent(token)}/invoices/${encodeURIComponent(invoiceId)}`,
    );
    return res.data.data.invoice;
  },
};
