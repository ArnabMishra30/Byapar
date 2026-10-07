import { apiClient } from "./client";
import type { ApiSuccessResponse } from "@/types/api";

// BUY X GET Y FREE. Saved offers are applied by the server when a sale is
// saved; the free item's stock goes out like any other line.

export interface Offer {
  id: string;
  name: string;
  buyProduct: { id: string; name: string; isCombo: boolean };
  buyQuantity: string;
  freeProduct: { id: string; name: string; isCombo: boolean };
  freeQuantity: string;
  startDate: string | null;
  endDate: string | null;
  isActive: boolean;
  /** Switched on and inside its dates today. */
  isRunning: boolean;
}

export interface OfferInput {
  name?: string;
  buyProductId: string;
  buyQuantity: string;
  freeProductId: string;
  freeQuantity: string;
  startDate?: string | null;
  endDate?: string | null;
}

export interface OffersReport {
  rows: {
    kind: "OFFER" | "BY_HAND";
    label: string;
    timesGiven: number;
    itemsGiven: { name: string; quantity: string }[];
    cost: string;
  }[];
  totalCost: string;
}

export const offersApi = {
  list: async (activeOnly = false): Promise<Offer[]> => {
    const res = await apiClient.get<ApiSuccessResponse<{ offers: Offer[] }>>("/offers", {
      params: activeOnly ? { active: "true" } : {},
    });
    return res.data.data.offers;
  },
  create: async (body: OfferInput): Promise<Offer> => {
    const res = await apiClient.post<ApiSuccessResponse<{ offer: Offer }>>("/offers", body);
    return res.data.data.offer;
  },
  setStatus: async (id: string, isActive: boolean): Promise<Offer> => {
    const res = await apiClient.patch<ApiSuccessResponse<{ offer: Offer }>>(`/offers/${id}/status`, { isActive });
    return res.data.data.offer;
  },
  report: async (range: { fromDate?: string; toDate?: string }): Promise<OffersReport> => {
    const res = await apiClient.get<ApiSuccessResponse<OffersReport>>("/reports/offers", { params: range });
    return res.data.data;
  },
};
