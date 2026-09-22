import { apiClient } from "./client";
import { getList, getOne, postOne, patchOne, type ListParams, type ListResult } from "./http";

// BILL IMPORT, from the shop's side.
//
// The browser uploads a file to OUR server and gets back structured fields. It
// never talks to any AI vendor and never holds a key - there is deliberately no
// NEXT_PUBLIC_ variable anywhere near this. The model is called server-side, by
// the backend, with a secret the browser has no way to see.

export type BillDirection = "IN" | "OUT";
export type BillStatus = "UPLOADED" | "PROCESSING" | "REVIEW" | "POSTED" | "FAILED" | "CANCELLED";

/** One line the extractor read off the bill. Every field may legitimately be null. */
export interface ExtractedLine {
  description: string | null;
  hsnCode: string | null;
  quantity: string | null;
  unit: string | null;
  unitPrice: string | null;
  discount: string | null;
  taxRate: string | null;
  lineTotal: string | null;
}

export interface ExtractedBill {
  partyName: string | null;
  partyGstin: string | null;
  partyPhone: string | null;
  partyAddress: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  subtotal: string | null;
  totalTax: string | null;
  totalDiscount: string | null;
  grandTotal: string | null;
  lines: ExtractedLine[];
  confidence: "HIGH" | "MEDIUM" | "LOW" | null;
  notes: string | null;
}

/** A supplier or customer the server believes this bill is with. */
export interface PartySuggestion {
  id: string;
  name: string;
  /** gstin | phone | name | similar-name - what the match was based on. */
  matchedBy: string;
}

/** The product a bill line appears to be, where there is a confident answer. */
export interface LineSuggestion {
  index: number;
  productId: string | null;
  productName?: string;
  matchedBy?: string;
}

export interface BillSuggestions {
  party: PartySuggestion | null;
  lines: LineSuggestion[];
}

/** Only what a bill can show. The rest of a party is set on its own screen. */
export interface NewPartyInput {
  name: string;
  phone?: string;
  gstin?: string;
  address?: string;
}

export interface NewProductInput {
  /** The position in document.items this product belongs to. */
  index: number;
  name: string;
  unit?: string | null;
  price?: string | null;
}

export interface Bill {
  id: string;
  direction: BillDirection;
  status: BillStatus;
  file: { name: string; mimeType: string; size: number };
  extraction: unknown | null;
  extractionModel: string | null;
  extractedAt: string | null;
  extractionError: string | null;
  reviewedData: ExtractedBill | null;
  posted: {
    sourceType: "PURCHASE" | "SALES_INVOICE";
    sourceId: string;
    postedAt: string;
    postedBy: { id: string; name: string } | null;
  } | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  uploadedBy: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface BillSummary {
  counts: Record<BillStatus, number>;
  awaitingReview: number;
  /** Whether the server has an AI key configured at all. */
  extractionConfigured: boolean;
}

export const billsApi = {
  list: (params?: ListParams): Promise<ListResult<Bill>> => getList<Bill>("/bills", params),

  get: (id: string): Promise<Bill> => getOne<Bill>(`/bills/${id}`, "bill"),

  summary: async (): Promise<BillSummary> => {
    const res = await apiClient.get<{ data: BillSummary }>("/bills/summary");
    return res.data.data;
  },

  /**
   * Sends the photo or PDF to our own server.
   *
   * THE CONTENT TYPE MUST BE SET HERE. The client's default is application/json,
   * and axios reacts to a JSON content type by converting FormData into a JSON
   * object (lib/defaults/index.js) - the file disappears and the server answers
   * 400 NO_FILE. Naming multipart/form-data stops that; axios then drops this
   * boundary-less header so the browser can supply the real one.
   */
  upload: async (file: File, direction: BillDirection): Promise<Bill> => {
    const form = new FormData();
    form.append("direction", direction);
    form.append("file", file);

    const res = await apiClient.post<{ data: { bill: Bill } }>("/bills", form, {
      headers: { "Content-Type": "multipart/form-data" },
      // Reading a bill takes a while; the default client timeout is too short.
      timeout: 120000,
    });
    return res.data.data.bill;
  },

  /** The stored image or PDF, fetched with the caller's token. */
  fileUrl: (id: string) => `/bills/${id}/file`,

  fileBlob: async (id: string): Promise<Blob> => {
    const res = await apiClient.get(`/bills/${id}/file`, { responseType: "blob" });
    return res.data as Blob;
  },

  retry: (id: string): Promise<Bill> => postOne<Bill>(`/bills/${id}/retry`, "bill"),

  saveReview: (id: string, reviewedData: ExtractedBill): Promise<Bill> =>
    patchOne<Bill>(`/bills/${id}/review`, "bill", { reviewedData }),

  /**
   * Confirms the bill and posts it.
   *
   * `document` is an ordinary purchase or sales payload carrying real ids the
   * user chose during review. The server holds it to the same schema the normal
   * form uses, and posts it through the same service - so an imported bill and a
   * typed one produce identical accounting.
   */
  confirm: async (
    id: string,
    document: Record<string, unknown>,
    extras: {
      /** A supplier or customer the bill names that the shop does not have yet. */
      newParty?: NewPartyInput | null;
      /** Products a bill line names that the shop does not stock yet. */
      newProducts?: NewProductInput[];
      postImmediately?: boolean;
    } = {}
  ): Promise<{ bill: Bill; document: Record<string, unknown> }> => {
    const { newParty = null, newProducts = [], postImmediately = true } = extras;
    const res = await apiClient.post<{
      data: { bill: Bill; document: Record<string, unknown> };
    }>(`/bills/${id}/confirm`, { document, postImmediately, newParty, newProducts });
    return res.data.data;
  },

  /**
   * What this bill looks like it refers to in the shop's own records.
   *
   * Advisory only: the server offers a supplier, and a product per line, when
   * it is confident, and says nothing when it is not. The reviewer decides.
   */
  suggestions: async (id: string): Promise<BillSuggestions> => {
    const res = await apiClient.get<{ data: BillSuggestions }>(`/bills/${id}/suggestions`);
    return res.data.data;
  },

  cancel: (id: string, reason?: string): Promise<Bill> =>
    postOne<Bill>(`/bills/${id}/cancel`, "bill", { reason }),
};
