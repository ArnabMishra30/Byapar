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
  customer: (SideTerms & { receivable: string; overdue: string; overdueCount: number }) | null;
  supplier: (SideTerms & { payable: string; overdue: string; overdueCount: number }) | null;
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
  relationship: PartyRelationship;
  /** Sent only after the shop has seen the similar parties and chosen "create new". */
  allowDuplicate?: boolean;
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
};

/** What a shopkeeper calls each relationship. */
export const RELATIONSHIP_LABEL: Record<PartyRelationship | "NONE", string> = {
  CUSTOMER: "Customer",
  SUPPLIER: "Supplier",
  BOTH: "Both",
  NONE: "—",
};
