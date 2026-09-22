import type { PublicPlan } from "@/lib/api/public";

/**
 * Formatting and comparison for the PRICING DISPLAY only.
 *
 * Plain JavaScript numbers are fine here, and deliberately so: nothing below is
 * business arithmetic. It decides how "500.0000" is printed and which card gets
 * a badge. Every real amount - what a shop is charged, what is recorded - is
 * decided by the backend in Decimal and never passes through this file.
 */

/** "300.00" -> "₹300", "1999.5" -> "₹1,999.50", in Indian digit grouping. */
export function formatRupees(value: string | number): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return `₹${value}`;

  const whole = Number.isInteger(amount);
  const formatted = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);

  return `₹${formatted}`;
}

/** How many months a plan runs for, approximately for day-based plans. */
export function monthsIn(plan: Pick<PublicPlan, "durationValue" | "durationUnit">): number | null {
  const value = Number(plan.durationValue);
  if (!Number.isFinite(value) || value <= 0) return null;

  switch (plan.durationUnit) {
    case "MONTH":
      return value;
    case "YEAR":
      return value * 12;
    case "DAY":
      return value / 30;
    default:
      return null;
  }
}

/** Price per month, or null when it would not mean anything. */
export function monthlyPrice(plan: PublicPlan): number | null {
  const months = monthsIn(plan);
  const price = Number(plan.price);
  if (months === null || months < 1 || !Number.isFinite(price)) return null;
  return price / months;
}

/**
 * The single plan that costs least per month, or null.
 *
 * "Best value" rather than "Most popular" on purpose: popularity is a claim this
 * site has no data for, whereas the cheapest monthly rate is simply true. A tie,
 * or a single plan, gets no badge at all.
 */
export function bestValuePlanId(plans: PublicPlan[]): string | null {
  if (plans.length < 2) return null;

  const scored = plans
    .map((plan) => ({ id: plan.id, rate: monthlyPrice(plan) }))
    .filter((entry): entry is { id: string; rate: number } => entry.rate !== null);

  if (scored.length < 2) return null;

  const lowest = Math.min(...scored.map((entry) => entry.rate));
  const winners = scored.filter((entry) => Math.abs(entry.rate - lowest) < 0.005);

  return winners.length === 1 ? winners[0].id : null;
}

/** A URL-friendly name, so /register?plan=6-months reads sensibly. */
export function planSlug(plan: Pick<PublicPlan, "name">): string {
  return plan.name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
