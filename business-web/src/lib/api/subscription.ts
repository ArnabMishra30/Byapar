import { apiClient } from "./client";

// WHAT THIS SHOP IS ENTITLED TO.
//
// Asked about ourselves and nobody else - there is no parameter for another
// company, and the server reads the company from the token regardless.
//
// This is a COURTESY, not a control. It exists so the app can say "12 days left"
// and show a renewal notice instead of a form that is going to be refused. What
// actually stops an expired shop posting lives in the backend, at the single
// point every posted document passes through.

export interface Entitlement {
  isEntitled: boolean;
  status: "ACTIVE" | "EXPIRED" | "CANCELLED" | "NONE";
  reason: string | null;
  plan: string | null;
  startDate?: string | null;
  endDate: string | null;
  daysRemaining: number | null;
}

export const subscriptionApi = {
  getMine: async (): Promise<Entitlement> => {
    const res = await apiClient.get<{ data: { subscription: Entitlement } }>("/my-subscription");
    return res.data.data.subscription;
  },
};
