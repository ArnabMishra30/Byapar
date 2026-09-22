"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchPublicPlans, type PublicPlan } from "@/lib/api/public";
import { CONFIGURED_PLANS } from "./site-config";

export type PlanSource = "backend" | "configured";

/**
 * The plans to show a visitor.
 *
 * THE BACKEND WINS. When the operator's own plan records come back, those are
 * shown - so a price changed in the platform console reaches this page with no
 * deploy. Only when the backend has nothing (a fresh install, or the API being
 * unreachable) does the configured price list stand in, so the page never shows
 * an empty pricing section.
 */
export function usePlans(): { plans: PublicPlan[]; isLoading: boolean; source: PlanSource } {
  const query = useQuery({
    queryKey: ["public", "plans"],
    queryFn: fetchPublicPlans,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const live = query.data ?? [];
  const fromBackend = live.length > 0;

  return {
    plans: fromBackend ? live : CONFIGURED_PLANS,
    isLoading: query.isLoading,
    source: fromBackend ? "backend" : "configured",
  };
}
