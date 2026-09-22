import { ApiError } from '../../utils/api-error.js';

/**
 * SUBSCRIPTION DATE AND STATUS RULES.
 *
 * Pure functions, no database. Every rule here decides something a shop pays
 * for, so each one is testable on its own the way the accounting calculators
 * are.
 */

/** A business date, "YYYY-MM-DD", at UTC midnight - the convention everywhere. */
export function toBusinessDate(value) {
  return typeof value === 'string' ? new Date(`${value}T00:00:00.000Z`) : value;
}

export function toDateString(date) {
  return date ? date.toISOString().slice(0, 10) : null;
}

/**
 * Adds a plan's duration to a date.
 *
 * Months are CLAMPED to the target month's length. Adding one month to 31
 * January must give 28 February, not roll forward into March - a naive
 * setUTCMonth does exactly that and would silently give the shop an extra day
 * or two, every time, for years.
 */
export function addDuration(from, value, unit) {
  const date = new Date(from.getTime());

  if (unit === 'DAY') {
    date.setUTCDate(date.getUTCDate() + value);
    return date;
  }

  const months = unit === 'YEAR' ? value * 12 : value;
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const day = date.getUTCDate();

  // Day 0 of the following month is the last day of the target month.
  const lastDayOfTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  return new Date(Date.UTC(year, month, Math.min(day, lastDayOfTarget)));
}

/**
 * When a new subscription period should START.
 *
 * THIS IS THE RULE THAT PROTECTS THE SHOP. If a subscription is still running,
 * a renewal begins the day AFTER it ends - so a shop that renews early keeps
 * every day it already paid for. Starting "today" instead would quietly delete
 * the remaining days, and the shop would have no way to notice.
 *
 * If nothing is running - a first purchase, or a lapsed shop coming back - the
 * new period starts today.
 *
 * @param {Date} today
 * @param {{ endDate: Date, status: string } | null} current the newest
 *   subscription this shop has, whatever its state
 */
export function resolveStartDate(today, current) {
  if (!current) return today;

  // A cancelled subscription grants nothing, however far away its end date is.
  if (current.status === 'CANCELLED') return today;

  const currentEnd = new Date(current.endDate);

  // Already lapsed: start fresh today rather than backdating into the gap,
  // which would sell the shop days that have already gone by.
  if (currentEnd < today) return today;

  const dayAfter = new Date(currentEnd.getTime());
  dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
  return dayAfter;
}

/**
 * The full period a purchase buys.
 *
 * The end date is INCLUSIVE, and a duration of one month starting on the 1st
 * therefore ends on the last day of that month, not on the 1st of the next.
 * Anyone reading "1 Sep to 30 Sep" understands it; "1 Sep to 1 Oct" invites an
 * argument about whether the 1st is covered.
 */
export function resolvePeriod(today, current, { durationValue, durationUnit }) {
  const startDate = resolveStartDate(today, current);
  const endExclusive = addDuration(startDate, durationValue, durationUnit);

  const endDate = new Date(endExclusive.getTime());
  endDate.setUTCDate(endDate.getUTCDate() - 1);

  return { startDate, endDate };
}

/**
 * What a subscription's status should be, read against a date.
 *
 * CANCELLED is a decision somebody made and time does not undo it. Everything
 * else is simply a question of whether the end date has passed.
 */
export function deriveStatus(subscription, asOf) {
  if (subscription.status === 'CANCELLED') return 'CANCELLED';
  return new Date(subscription.endDate) < asOf ? 'EXPIRED' : 'ACTIVE';
}

/** Whether a shop may use the application on this date. */
export function isEntitled(subscription, asOf) {
  if (!subscription) return false;
  return deriveStatus(subscription, asOf) === 'ACTIVE';
}

/** Days until a subscription lapses. Negative once it has. */
export function daysRemaining(subscription, asOf) {
  if (!subscription) return null;
  const end = new Date(subscription.endDate);
  return Math.round((end.getTime() - asOf.getTime()) / 86400000);
}

/**
 * Refuses a plan that cannot be sold.
 *
 * A deactivated plan stays in the database because subscriptions reference it,
 * but nobody may buy it again.
 */
export function assertPlanSellable(plan) {
  if (!plan) {
    throw ApiError.business(404, 'PLAN_NOT_FOUND', 'Plan not found');
  }
  if (!plan.isActive) {
    throw ApiError.business(
      422,
      'PLAN_INACTIVE',
      `"${plan.name}" is no longer offered. Choose a plan that is currently available.`,
    );
  }
  return plan;
}
