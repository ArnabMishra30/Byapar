import axios from "axios";
import { APP_CONFIG } from "@/lib/constants";

// THE ONLY API CALL MADE BY A VISITOR WHO IS NOT SIGNED IN.
//
// It uses a bare axios instance rather than the app's `apiClient`, on purpose:
// that client attaches a bearer token and redirects to the login screen on a
// 401. Neither behaviour makes sense on a marketing page, and a visitor with a
// stale token in localStorage should not be bounced out of the pricing section.

export interface PublicPlan {
  id: string;
  name: string;
  description: string | null;
  price: string;
  currency: string;
  durationValue: number;
  durationUnit: "DAY" | "MONTH" | "YEAR";
  durationLabel: string;
}

const client = axios.create({ baseURL: APP_CONFIG.apiUrl, timeout: 5000 });

/**
 * The plans currently on sale.
 *
 * Prices come from the operator's own plan records, so the pricing section and
 * what a sales rep actually charges cannot drift apart. The landing page falls
 * back to a configured price list (site-config.ts) only when this returns none.
 *
 * Returns an empty list if the backend is unreachable. A marketing page that
 * fails to load must not show a broken screen - it shows the rest of the page
 * and invites the visitor to get in touch instead.
 */
export async function fetchPublicPlans(): Promise<PublicPlan[]> {
  // No backend configured for this build: nothing to ask, use the fallback.
  if (!APP_CONFIG.apiConfigured) return [];
  try {
    const res = await client.get<{ data: { plans: PublicPlan[] } }>("/public/plans");
    return res.data?.data?.plans ?? [];
  } catch {
    return [];
  }
}
