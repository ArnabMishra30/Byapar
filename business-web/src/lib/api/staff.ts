import { apiClient } from "./client";
import type { ApiSuccessResponse, User } from "@/types/api";

// PER-USER PERMISSIONS for a shop's staff, and who billed what.

export interface ShopRoleTemplate {
  key: string;
  label: string;
  permissions: string[];
}

export interface ShopRolesCatalog {
  permissions: { key: string; label: string }[];
  roles: ShopRoleTemplate[];
}

export interface StaffInput {
  name?: string;
  email?: string;
  password?: string;
  role?: "ADMIN" | "STAFF";
  shopRole?: string;
  permissions?: string[];
}

export interface PersonDay {
  user: { id: string; name: string; role?: string; shopRole?: string | null };
  salesCount: number;
  salesTotal: string;
  cancelledCount: number;
  collected: string;
  collectedByMethod: Record<string, string>;
  /** Lines sold at a price other than the product's own. */
  priceChangedCount: number;
}

export interface BillerDay {
  date: string;
  people: PersonDay[];
  totals: { salesCount: number; salesTotal: string; collected: string };
}

export const staffAccessApi = {
  roles: async (): Promise<ShopRolesCatalog> => {
    const res = await apiClient.get<ApiSuccessResponse<ShopRolesCatalog>>("/users/roles");
    return res.data.data;
  },
  list: async (): Promise<User[]> => {
    const res = await apiClient.get<{ data: User[] }>("/users", { params: { limit: 100 } });
    return res.data.data;
  },
  create: async (body: StaffInput): Promise<User> => {
    const res = await apiClient.post<ApiSuccessResponse<{ user: User }>>("/users", body);
    return res.data.data.user;
  },
  update: async (id: string, body: StaffInput): Promise<User> => {
    const res = await apiClient.patch<ApiSuccessResponse<{ user: User }>>(`/users/${id}`, body);
    return res.data.data.user;
  },
};

export const billerReportApi = {
  /** Every person's day (needs "see reports"). */
  billers: async (date?: string): Promise<BillerDay> => {
    const res = await apiClient.get<ApiSuccessResponse<BillerDay>>("/reports/billers", { params: date ? { date } : {} });
    return res.data.data;
  },
  /** The signed-in person's own day. */
  myDay: async (date?: string): Promise<PersonDay & { date: string }> => {
    const res = await apiClient.get<ApiSuccessResponse<PersonDay & { date: string }>>("/my-day", {
      params: date ? { date } : {},
    });
    return res.data.data;
  },
};

/** What a shopkeeper calls each payment method. */
export const METHOD_LABEL: Record<string, string> = {
  CASH: "Cash",
  UPI: "UPI",
  BANK: "Bank",
  CHEQUE: "Cheque",
  OTHER: "Other",
};
