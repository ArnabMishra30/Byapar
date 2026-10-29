import { apiClient, cleanParams } from "./client";
import { getList, getOne, patchOne, postOne, type ListParams } from "./http";
import type { ApiSuccessResponse } from "@/types/api";

// PARTIES: the business behind a customer, a supplier, or both.
//
// A party that is both has two separate balances - what they owe you and what
// you owe them - and the backend never nets them. Nor does anything here.

export type PartyRelationship = "CUSTOMER" | "SUPPLIER" | "BOTH";

export interface Party {
  id: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  alternatePhone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  stateCode: string | null;
  pincode: string | null;
  country: string | null;
  gstin: string | null;
  pan: string | null;
  notes: string | null;
  isActive: boolean;
  relationship: PartyRelationship | "NONE";
  isCustomer: boolean;
  isSupplier: boolean;
  customerId: string | null;
  supplierId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A row on the parties list: each side's balance, null when there is no such side. */
export interface PartyListRow extends Party {
  receivable: string | null;
  payable: string | null;
  lastTransactionDate: string | null;
}

interface SideTerms {
  id: string;
  isActive: boolean;
  openingBalance: string;
  creditLimit: string;
  isUnlimited: boolean;
  creditDays: number | null;
  gstRegistrationType: string;
}

export interface PartyDetail extends Party {
  // Balances are null for a user not allowed to see them (e.g. a cashier and a
  // supplier's balance).
  customer: (SideTerms & { receivable: string | null; overdue: string | null; overdueCount: number | null }) | null;
  supplier: (SideTerms & { payable: string | null; overdue: string | null; overdueCount: number | null }) | null;
}

export interface PartyMatch {
  party: {
    id: string;
    name: string;
    phone: string | null;
    gstin: string | null;
    email: string | null;
    isActive: boolean;
    relationship: PartyRelationship | "NONE";
    customerId: string | null;
    supplierId: string | null;
  };
  reasons: Array<"gstin" | "phone" | "email" | "name">;
}

export interface PartyCounts {
  total: number;
  customers: number;
  suppliers: number;
  both: number;
}

export interface SideTermsInput {
  creditLimit?: string;
  creditDays?: number | null;
  openingBalance?: string;
}

export interface PartyInput {
  name: string;
  contactPerson?: string | null;
  phone?: string | null;
  alternatePhone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  stateCode?: string | null;
  pincode?: string | null;
  gstin?: string | null;
  pan?: string | null;
  notes?: string | null;
  customer?: SideTermsInput;
  supplier?: SideTermsInput;
}

export interface CreatePartyInput extends PartyInput {
  /** Optional: when omitted the backend creates a party as both sides. */
  relationship?: PartyRelationship;
  /** Sent only after the shop has seen the similar parties and chosen "create new". */
  allowDuplicate?: boolean;
}

// --- the unified Vyapar-style statement ------------------------------------

export type StatementType = "ALL" | "SALES" | "PURCHASES" | "RECEIPTS" | "PAYMENTS" | "RETURNS";

export interface StatementParams {
  fromDate?: string;
  toDate?: string;
  type?: StatementType;
  search?: string;
  includeItems?: boolean;
}

export interface StatementItem {
  sno: number;
  name: string;
  hsn: string | null;
  unit: string | null;
  quantity: string;
  unitPrice: string;
  discount: string | null;
  tax: string | null;
  amount: string;
}

export interface StatementLine {
  date: string | null;
  side: "customer" | "supplier";
  entryType: string;
  kind: "SALE" | "PURCHASE" | "RECEIPT" | "PAYMENT" | "SALES_RETURN" | "PURCHASE_RETURN" | "OPENING" | string;
  label: string;
  documentId: string;
  documentNumber: string | null;
  referenceType: string;
  reference: string | null;
  dueDate: string | null;
  paymentMethod: string | null;
  /** A receipt's / payment's own metadata, shown beneath its row. Null elsewhere. */
  payment: {
    mode: string | null;
    modeLabel: string | null;
    reference: string | null;
    notes: string | null;
    allocated: string | null;
    unallocated: string | null;
    allocations: { documentNumber: string | null; amount: string }[];
  } | null;
  paymentStatus: string | null;
  total: string;
  receivedPaid: string;
  /** The transaction's own amount at posting; not changed by later payments. */
  txnBalance: string;
  /** The document's live open amount after all allocations, or null. */
  currentOutstanding: string | null;
  debit: string;
  credit: string;
  receivableBalance: string;
  payableBalance: string;
  document: {
    subtotal: string | null;
    discount: string | null;
    tax: string | null;
    total: string | null;
    outstanding: string | null;
    paid: string | null;
    items: StatementItem[] | null;
    allocations: { documentNumber: string | null; amount: string }[] | null;
  } | null;
}

export interface PartyStatement {
  party: {
    id: string;
    name: string;
    contactPerson: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    gstin: string | null;
    stateCode: string | null;
    relationship: PartyRelationship | "NONE";
    customerId: string | null;
    supplierId: string | null;
  };
  company: {
    name: string | null;
    legalName: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    gstin: string | null;
    stateCode: string | null;
    stateName: string | null;
  };
  period: { fromDate: string | null; toDate: string | null; label: string };
  filters: { type: string; search: string | null; includeItems: boolean };
  generatedAt: string;
  openingReceivable: string;
  openingPayable: string;
  lines: StatementLine[];
  summary: {
    closingReceivable: string;
    closingPayable: string;
    customerAdvance: string;
    supplierAdvance: string;
    totalSales: string;
    totalReceived: string;
    totalPurchases: string;
    totalPaid: string;
    totalSalesReturns: string;
    totalPurchaseReturns: string;
    entryCount: number;
    shownCount: number;
  };
  basis: string;
}

/** Statement query params as the backend reads them (booleans as strings). */
function statementQuery(params?: StatementParams): Record<string, unknown> {
  const query: Record<string, unknown> = {
    fromDate: params?.fromDate,
    toDate: params?.toDate,
    type: params?.type,
    search: params?.search,
  };
  // Only send includeItems when turning it OFF, so a dropped "false" cannot
  // silently re-enable the per-document rows in a download.
  if (params?.includeItems === false) query.includeItems = "false";
  return query;
}

export const partiesApi = {
  list: (p?: ListParams & { relationship?: "ALL" | PartyRelationship; isActive?: string }) =>
    getList<PartyListRow>("/parties", p),
  summary: () => getOne<PartyCounts>("/parties/summary", "counts"),
  get: (id: string) => getOne<PartyDetail>(`/parties/${id}`, "party"),
  create: (body: CreatePartyInput) => postOne<PartyDetail>("/parties", "party", body),
  update: (id: string, body: Partial<PartyInput>) => patchOne<PartyDetail>(`/parties/${id}`, "party", body),
  setStatus: (id: string, isActive: boolean) =>
    patchOne<PartyDetail>(`/parties/${id}/status`, "party", { isActive }),
  /** Make a customer a supplier too, or the other way round. */
  addRelationship: (id: string, role: "CUSTOMER" | "SUPPLIER") =>
    postOne<PartyDetail>(`/parties/${id}/relationships`, "party", { role }),
  /** Join an existing customer or supplier record to this party. */
  link: (id: string, body: { customerId: string } | { supplierId: string }) =>
    postOne<PartyDetail>(`/parties/${id}/link`, "party", body),
  possibleMatches: async (q: {
    name?: string;
    phone?: string;
    email?: string;
    gstin?: string;
    excludeId?: string;
  }): Promise<PartyMatch[]> => {
    const res = await apiClient.get<ApiSuccessResponse<{ matches: PartyMatch[] }>>(
      "/parties/possible-matches",
      { params: cleanParams(q) },
    );
    return res.data.data.matches;
  },
  /** The unified party statement: one merged ledger, two independent balances. */
  statement: async (id: string, params?: StatementParams): Promise<PartyStatement> => {
    const res = await apiClient.get<ApiSuccessResponse<PartyStatement>>(
      `/parties/${id}/statement`,
      { params: cleanParams(statementQuery(params)) },
    );
    return res.data.data;
  },
  /** The statement as a downloaded PDF or .xlsx, generated server-side. */
  statementFile: async (id: string, format: "pdf" | "xlsx", params?: StatementParams): Promise<Blob> => {
    const res = await apiClient.get(`/parties/${id}/statement.${format}`, {
      params: cleanParams(statementQuery(params)),
      responseType: "blob",
    });
    return res.data as Blob;
  },
};

/** What a shopkeeper calls each relationship. */
export const RELATIONSHIP_LABEL: Record<PartyRelationship | "NONE", string> = {
  CUSTOMER: "Customer",
  SUPPLIER: "Supplier",
  BOTH: "Both",
  NONE: "—",
};
