import { apiClient } from "./client";
import { ApiSuccessResponse } from "@/types/api";

// THE SaaS LAYER, from the operator's console.
//
// Plans, the sales team, the shops they sign up, and the money they collect.
// None of this touches a shop's own accounting - the two only meet at the
// business record they both point at.

interface Paginated<T> {
  data: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  description: string | null;
  price: string;
  currency: string;
  durationValue: number;
  durationUnit: "DAY" | "MONTH" | "YEAR";
  duration?: string;
  isActive: boolean;
  createdAt: string;
}

export interface Subscription {
  id: string;
  company: { id: string; name: string } | null;
  plan: { id: string; name: string; currentName?: string } | null;
  price: string;
  currency: string;
  duration: string;
  startDate: string;
  endDate: string;
  status: "PENDING" | "ACTIVE" | "EXPIRED" | "CANCELLED";
  storedStatus?: string;
  daysRemaining: number | null;
  isRenewal?: boolean;
  /** SALE, or ADMIN_GRANT for a manual recharge or free grant. */
  origin?: "SALE" | "ADMIN_GRANT";
  grantReason?: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  soldBy: { id: string; name: string } | null;
}

export interface SubscriptionPayment {
  id: string;
  amount: string;
  method: string;
  reference: string | null;
  paidAt: string;
  notes?: string | null;
  collectedBy: { id: string; name: string } | null;
  subscription?: {
    id: string;
    planNameSnapshot: string;
    company: { id: string; name: string };
  };
}

export interface Business {
  id: string;
  name: string;
  ownerName: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  pincode: string | null;
  gstin: string | null;
  gstEnabled: boolean;
  isActive: boolean;
  onboardedBy: { id: string; name: string } | null;
  createdAt: string;
  subscriptions?: Array<{
    id: string;
    plan: string;
    price: string;
    startDate: string;
    endDate: string;
    status: string;
  }>;
  currentSubscription?: {
    id: string;
    plan: string;
    endDate: string;
    status: string;
  } | null;
}

export interface SalesStaff {
  id: string;
  email: string;
  name: string;
  role: "PLATFORM_ADMIN" | "SALES_STAFF";
  permissions: string[];
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  shopsOnboarded?: number;
  paymentsCollected?: { total: string; count: number };
}

export interface RechargePreview {
  plan: { id: string; name: string; price: string };
  current: { plan: string; endDate: string; status: string } | null;
  /** True when this ADDS to a running subscription rather than starting fresh. */
  extending: boolean;
  startDate: string;
  endDate: string;
  duration: string;
  explanation: string;
}

export interface GrantPayload {
  companyId: string;
  planId: string;
  /** Always required. It is the only record of why a shop has access. */
  reason: string;
  /** Omitted or "0" means a free grant, and no payment is recorded. */
  amount?: string;
  method?: string;
  reference?: string | null;
  durationValue?: number;
  durationUnit?: "DAY" | "MONTH" | "YEAR";
}

export interface BusinessHistory {
  subscriptions: Subscription[];
  payments: SubscriptionPayment[];
}

export interface CreatePlanPayload {
  name: string;
  description?: string | null;
  price: string;
  durationValue: number;
  durationUnit: "DAY" | "MONTH" | "YEAR";
}

export interface OnboardBusinessPayload {
  name: string;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  pincode?: string | null;
  address?: string | null;
  gstin?: string | null;
  stateCode?: string | null;
  owner: { name: string; email: string; password: string };
  planId?: string;
  payment?: { amount: string; method?: string; reference?: string | null };
}

function toQuery(params: Record<string, unknown> = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  });
  const query = search.toString();
  return query ? `?${query}` : "";
}

export const platformApi = {
  // --- plans ---------------------------------------------------------------
  listPlans: async (params?: Record<string, unknown>): Promise<Paginated<SubscriptionPlan>> => {
    const res = await apiClient.get(`/plans${toQuery(params)}`);
    return { data: res.data.data, pagination: res.data.pagination };
  },

  createPlan: async (payload: CreatePlanPayload): Promise<SubscriptionPlan> => {
    const res = await apiClient.post<ApiSuccessResponse<{ plan: SubscriptionPlan }>>(
      "/plans",
      payload
    );
    return res.data.data.plan;
  },

  updatePlan: async (
    id: string,
    payload: Partial<CreatePlanPayload>
  ): Promise<SubscriptionPlan> => {
    const res = await apiClient.patch<ApiSuccessResponse<{ plan: SubscriptionPlan }>>(
      `/plans/${id}`,
      payload
    );
    return res.data.data.plan;
  },

  // A plan in use is deactivated, never deleted - subscriptions reference it.
  setPlanActive: async (id: string, isActive: boolean): Promise<SubscriptionPlan> => {
    const res = await apiClient.patch<ApiSuccessResponse<{ plan: SubscriptionPlan }>>(
      `/plans/${id}/status`,
      { isActive }
    );
    return res.data.data.plan;
  },

  // --- businesses ----------------------------------------------------------
  listBusinesses: async (params?: Record<string, unknown>): Promise<Paginated<Business>> => {
    const res = await apiClient.get(`/businesses${toQuery(params)}`);
    return { data: res.data.data, pagination: res.data.pagination };
  },

  getBusiness: async (id: string): Promise<Business> => {
    const res = await apiClient.get<ApiSuccessResponse<{ business: Business }>>(
      `/businesses/${id}`
    );
    return res.data.data.business;
  },

  onboardBusiness: async (payload: OnboardBusinessPayload) => {
    const res = await apiClient.post<
      ApiSuccessResponse<{
        business: Business;
        owner: { email: string; name: string };
        subscription: { plan: string; price: string; endDate: string } | null;
        payment: { amount: string; method: string } | null;
      }>
    >("/businesses/onboard", payload);
    return res.data.data;
  },

  setBusinessActive: async (id: string, isActive: boolean): Promise<Business> => {
    const res = await apiClient.patch<ApiSuccessResponse<{ business: Business }>>(
      `/businesses/${id}/status`,
      { isActive }
    );
    return res.data.data.business;
  },

// --- manual recharge / grant ---------------------------------------------

  /** What a recharge WOULD do. Read-only: it changes nothing. */
  previewRecharge: async (
    businessId: string,
    params: { planId: string; durationValue?: number; durationUnit?: string }
  ): Promise<RechargePreview> => {
    const res = await apiClient.get<ApiSuccessResponse<{ preview: RechargePreview }>>(
      `/businesses/${businessId}/recharge-preview${toQuery(params)}`
    );
    return res.data.data.preview;
  },

  /**
   * An admin gives a shop a subscription by hand.
   *
   * No payment gateway is involved - this records an offline payment or an
   * outright grant. The server gates it on SUBSCRIPTION_GRANT.
   */
  grantSubscription: async (payload: GrantPayload) => {
    const res = await apiClient.post<
      ApiSuccessResponse<{
        subscription: Subscription;
        payment: SubscriptionPayment | null;
        previous: { plan: string; endDate: string; status: string } | null;
        reactivated: boolean;
      }>
    >("/subscriptions/grant", payload);
    return res.data.data;
  },

  /** A shop's full subscription and payment history - the audit trail. */
  getBusinessHistory: async (businessId: string): Promise<BusinessHistory> => {
    const res = await apiClient.get<ApiSuccessResponse<BusinessHistory>>(
      `/businesses/${businessId}/history`
    );
    return res.data.data;
  },

  // --- subscriptions -------------------------------------------------------
  listSubscriptions: async (
    params?: Record<string, unknown>
  ): Promise<Paginated<Subscription>> => {
    const res = await apiClient.get(`/subscriptions${toQuery(params)}`);
    return { data: res.data.data, pagination: res.data.pagination };
  },

  getSubscription: async (id: string): Promise<Subscription> => {
    const res = await apiClient.get<ApiSuccessResponse<{ subscription: Subscription }>>(
      `/subscriptions/${id}`
    );
    return res.data.data.subscription;
  },

  createSubscription: async (payload: {
    companyId: string;
    planId: string;
    payment?: { amount: string; method?: string; reference?: string | null };
  }) => {
    const res = await apiClient.post<
      ApiSuccessResponse<{ subscription: Subscription; payment: SubscriptionPayment | null }>
    >("/subscriptions", payload);
    return res.data.data;
  },

  cancelSubscription: async (id: string, reason: string): Promise<Subscription> => {
    const res = await apiClient.post<ApiSuccessResponse<{ subscription: Subscription }>>(
      `/subscriptions/${id}/cancel`,
      { reason }
    );
    return res.data.data.subscription;
  },

  // --- payments ------------------------------------------------------------
  listPayments: async (
    params?: Record<string, unknown>
  ): Promise<Paginated<SubscriptionPayment>> => {
    const res = await apiClient.get(`/subscription-payments${toQuery(params)}`);
    return { data: res.data.data, pagination: res.data.pagination };
  },

  listPaymentsForSubscription: async (id: string): Promise<SubscriptionPayment[]> => {
    const res = await apiClient.get<ApiSuccessResponse<{ payments: SubscriptionPayment[] }>>(
      `/subscriptions/${id}/payments`
    );
    return res.data.data.payments;
  },

  recordPayment: async (
    subscriptionId: string,
    payload: { amount: string; method?: string; reference?: string | null }
  ): Promise<SubscriptionPayment> => {
    const res = await apiClient.post<ApiSuccessResponse<{ payment: SubscriptionPayment }>>(
      `/subscriptions/${subscriptionId}/payments`,
      payload
    );
    return res.data.data.payment;
  },

  // --- sales team ----------------------------------------------------------
  listStaff: async (params?: Record<string, unknown>): Promise<Paginated<SalesStaff>> => {
    const res = await apiClient.get(`/sales-team${toQuery(params)}`);
    return { data: res.data.data, pagination: res.data.pagination };
  },

  getStaff: async (id: string): Promise<SalesStaff> => {
    const res = await apiClient.get<ApiSuccessResponse<{ staff: SalesStaff }>>(
      `/sales-team/${id}`
    );
    return res.data.data.staff;
  },

  createStaff: async (payload: {
    name: string;
    email: string;
    password: string;
    role?: string;
    permissions?: string[];
  }): Promise<SalesStaff> => {
    const res = await apiClient.post<ApiSuccessResponse<{ staff: SalesStaff }>>(
      "/sales-team",
      payload
    );
    return res.data.data.staff;
  },

  updateStaff: async (
    id: string,
    payload: { name?: string; role?: string; permissions?: string[]; isActive?: boolean }
  ): Promise<SalesStaff> => {
    const res = await apiClient.patch<ApiSuccessResponse<{ staff: SalesStaff }>>(
      `/sales-team/${id}`,
      payload
    );
    return res.data.data.staff;
  },

  /** The permission catalogue, so a form never hardcodes the list. */
  listPermissions: async (): Promise<{ permissions: string[]; defaults: string[] }> => {
    const res = await apiClient.get<
      ApiSuccessResponse<{ permissions: string[]; defaults: string[] }>
    >("/sales-team/permissions");
    return res.data.data;
  },
};
