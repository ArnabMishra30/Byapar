import { subtract, divide, multiply, round, toDecimal, isZero, toMoneyString } from '../../utils/money.js';

// Business periods, and comparing one with another.
//
// WHAT "TODAY" MEANS
//   Business dates in this system are DATE columns stored at UTC midnight. "Today"
//   for a shop in Mumbai is not the same instant as "today" in UTC - between
//   00:00 and 05:30 IST the two disagree by a day, which would put a morning's
//   sales in yesterday's dashboard.
//
//   So today is resolved in the COMPANY'S OWN timezone, taken from its settings,
//   and then turned back into a UTC-midnight date to match the stored columns.
//   `Intl` does the timezone arithmetic; no dependency and no hand-rolled offsets.

/** The calendar date in a timezone, as "YYYY-MM-DD". */
export function todayIn(timeZone) {
  try {
    // en-CA formats as YYYY-MM-DD, which is exactly what a DATE column wants.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    // An unknown timezone must not take the dashboard down.
    return new Date().toISOString().slice(0, 10);
  }
}

/** "YYYY-MM-DD" as the UTC-midnight Date the business-date columns store. */
export function toBusinessDate(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

/** A Date back to "YYYY-MM-DD". */
export function toDateString(date) {
  return date ? date.toISOString().slice(0, 10) : null;
}

/** Whole days added to a business date. Never touches local time. */
export function addDays(date, days) {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * Whole months added to a business date, CLAMPED to the target month's length.
 *
 * A naive setUTCMonth overflows: 31 March minus one month asks for 31 February,
 * which JavaScript silently rolls forward into March again. Clamping to the last
 * valid day gives 28 February, which is what a person means.
 */
export function addMonths(date, months) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  // Day 0 of the following month is the last day of the target month.
  const lastDayOfTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  return new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), lastDayOfTarget)));
}

/** The first day of the month a date falls in. */
export function startOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** The last day of that month. */
export function endOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

/**
 * The week a date falls in, Monday to Sunday.
 *
 * Monday is the convention here because a business week is usually described that
 * way; it is stated rather than assumed so a reader knows which it is.
 */
export function startOfWeek(date) {
  const day = date.getUTCDay();
  // getUTCDay: 0 = Sunday. Monday-based offset.
  const offset = day === 0 ? 6 : day - 1;
  return addDays(date, -offset);
}

export function endOfWeek(date) {
  return addDays(startOfWeek(date), 6);
}

/**
 * The set of periods a dashboard shows, all derived from one "today".
 *
 * Each comes with the equivalent previous period, so a comparison is like for
 * like: this month against last month, not against a partial one.
 */
export function buildPeriods(today) {
  const yesterday = addDays(today, -1);

  const weekStart = startOfWeek(today);
  const weekEnd = endOfWeek(today);
  const previousWeekStart = addDays(weekStart, -7);
  const previousWeekEnd = addDays(weekStart, -1);

  const monthStart = startOfMonth(today);
  const monthEnd = endOfMonth(today);
  const previousMonthStart = startOfMonth(addMonths(monthStart, -1));
  const previousMonthEnd = endOfMonth(previousMonthStart);

  return {
    today: { fromDate: today, toDate: today, label: 'Today' },
    yesterday: { fromDate: yesterday, toDate: yesterday, label: 'Yesterday' },
    thisWeek: { fromDate: weekStart, toDate: weekEnd, label: 'This week' },
    previousWeek: { fromDate: previousWeekStart, toDate: previousWeekEnd, label: 'Last week' },
    thisMonth: { fromDate: monthStart, toDate: monthEnd, label: 'This month' },
    previousMonth: {
      fromDate: previousMonthStart,
      toDate: previousMonthEnd,
      label: 'Last month',
    },
  };
}

export function toPublicPeriod(period) {
  return {
    label: period.label,
    fromDate: toDateString(period.fromDate),
    toDate: toDateString(period.toDate),
  };
}

/**
 * How this period compares with the last one.
 *
 * `changePercent` is null when the previous period was zero: "up from nothing"
 * has no percentage, and reporting an infinite or 100% rise would be a lie.
 */
export function compareValues(current, previous) {
  const now = toDecimal(current ?? 0);
  const before = toDecimal(previous ?? 0);
  const change = subtract(now, before);

  return {
    current: toMoneyString(now, 2),
    previous: toMoneyString(before, 2),
    change: toMoneyString(change, 2),
    changePercent: isZero(before)
      ? null
      : toMoneyString(round(divide(multiply(change, 100), before), 2), 2),
    direction: isZero(change) ? 'FLAT' : change.isNegative() ? 'DOWN' : 'UP',
  };
}
