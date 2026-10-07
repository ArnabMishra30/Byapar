import { apiClient } from "./client";
import type { ApiSuccessResponse } from "@/types/api";

// The shop's own money accounts: Cash drawer, SBI current, PhonePe / UPI...
// Each is a real ledger account; balances come straight from the ledger.

/** Reference details of a bank / UPI account. */
export interface MoneyAccountDetails {
  bankName: string;
  accountNumber: string;
  ifsc: string;
  upiId: string;
  holderName: string;
}

export interface MoneyAccount {
  id: string;
  name: string;
  code: string;
  kind: "CASH" | "BANK";
  isSystem: boolean;
  isActive: boolean;
  balance: string;
  bankName: string | null;
  /** In full for the owner; masked (••••1234) for staff. */
  accountNumber: string | null;
  accountNumberMasked: string | null;
  ifsc: string | null;
  upiId: string | null;
  holderName: string | null;
}

export interface MoneyTransfer {
  id: string;
  number: string;
  date: string;
  from: { id: string; name: string } | null;
  to: { id: string; name: string } | null;
  amount: string;
  description: string;
  isReversed: boolean;
}

export const moneyAccountsApi = {
  list: async (activeOnly = false): Promise<MoneyAccount[]> => {
    const res = await apiClient.get<ApiSuccessResponse<{ accounts: MoneyAccount[] }>>("/money-accounts", {
      params: activeOnly ? { active: "true" } : {},
    });
    return res.data.data.accounts;
  },
  create: async (
    body: { name: string; kind: "CASH" | "BANK"; openingBalance?: string; openingDate?: string } & Partial<MoneyAccountDetails>,
  ) => {
    const res = await apiClient.post<ApiSuccessResponse<{ account: MoneyAccount }>>("/money-accounts", body);
    return res.data.data.account;
  },
  update: async (id: string, body: { name?: string; isActive?: boolean } & Partial<MoneyAccountDetails>) => {
    const res = await apiClient.patch<ApiSuccessResponse<{ account: MoneyAccount }>>(`/money-accounts/${id}`, body);
    return res.data.data.account;
  },
  transfers: async (): Promise<MoneyTransfer[]> => {
    const res = await apiClient.get<ApiSuccessResponse<{ transfers: MoneyTransfer[] }>>("/money-accounts/transfers");
    return res.data.data.transfers;
  },
  transfer: async (body: { fromAccountId: string; toAccountId: string; amount: string; date: string; notes?: string | null }) => {
    const res = await apiClient.post<ApiSuccessResponse<{ transfer: MoneyTransfer }>>("/money-accounts/transfers", body);
    return res.data.data.transfer;
  },
  reverseTransfer: async (id: string) => {
    await apiClient.post(`/money-accounts/transfers/${id}/reverse`);
  },
};
