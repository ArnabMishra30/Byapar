import { describe, it, expect } from 'vitest';
import {
  todayIn,
  toBusinessDate,
  toDateString,
  addDays,
  addMonths,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  buildPeriods,
  toPublicPeriod,
  compareValues,
} from '../../src/modules/reports/period.js';
import { summariseInventory } from '../../src/modules/reports/dashboard.service.js';
import { daysBetween, ageingBucket } from '../../src/modules/reports/credit.service.js';

// The pure parts of the dashboard: period arithmetic, comparisons, ageing and
// inventory valuation. No database.

const date = (value) => toBusinessDate(value);

describe('resolving "today"', () => {
  it('uses the company timezone, not the server clock', () => {
    // The whole point: a Mumbai shop's day rolls over 5.5 hours before UTC's,
    // so a sale made at 06:00 IST must not land in yesterday's dashboard.
    const inIndia = todayIn('Asia/Kolkata');
    const inSamoa = todayIn('Pacific/Apia');

    expect(inIndia).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(inSamoa).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('falls back to UTC rather than failing on an unknown timezone', () => {
    // A bad settings value must not take the dashboard down.
    expect(todayIn('Not/AZone')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(todayIn(undefined)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('converts a date string to the UTC midnight the DATE columns store', () => {
    expect(toBusinessDate('2026-09-16').toISOString()).toBe('2026-09-16T00:00:00.000Z');
    expect(toDateString(toBusinessDate('2026-09-16'))).toBe('2026-09-16');
    expect(toDateString(null)).toBeNull();
  });
});

describe('date arithmetic', () => {
  it('adds and subtracts days without drifting through local time', () => {
    expect(toDateString(addDays(date('2026-09-16'), 1))).toBe('2026-09-17');
    expect(toDateString(addDays(date('2026-09-16'), -1))).toBe('2026-09-15');
    expect(toDateString(addDays(date('2026-03-01'), -1))).toBe('2026-02-28');
    expect(toDateString(addDays(date('2026-12-31'), 1))).toBe('2027-01-01');
  });

  it('handles a leap year', () => {
    expect(toDateString(addDays(date('2028-02-28'), 1))).toBe('2028-02-29');
    expect(toDateString(endOfMonth(date('2028-02-10')))).toBe('2028-02-29');
  });

  it('finds the first and last day of a month', () => {
    expect(toDateString(startOfMonth(date('2026-09-16')))).toBe('2026-09-01');
    expect(toDateString(endOfMonth(date('2026-09-16')))).toBe('2026-09-30');
    expect(toDateString(endOfMonth(date('2026-02-10')))).toBe('2026-02-28');
    expect(toDateString(endOfMonth(date('2026-12-05')))).toBe('2026-12-31');
  });

  it('steps back a month from the 31st without landing in the wrong one', () => {
    expect(toDateString(startOfMonth(addMonths(date('2026-03-31'), -1)))).toBe('2026-02-01');
  });

  it('runs a week Monday to Sunday', () => {
    // 2026-09-16 is a Wednesday.
    expect(toDateString(startOfWeek(date('2026-09-16')))).toBe('2026-09-14');
    expect(toDateString(endOfWeek(date('2026-09-16')))).toBe('2026-09-20');
  });

  it('treats Sunday as the END of its week, not the start', () => {
    // 2026-09-20 is a Sunday: the week it closes began on the 14th.
    expect(toDateString(startOfWeek(date('2026-09-20')))).toBe('2026-09-14');
    expect(toDateString(startOfWeek(date('2026-09-21')))).toBe('2026-09-21');
  });
});

describe('the dashboard periods', () => {
  const periods = buildPeriods(date('2026-09-16'));

  it('builds today and yesterday', () => {
    expect(toPublicPeriod(periods.today)).toEqual({
      label: 'Today',
      fromDate: '2026-09-16',
      toDate: '2026-09-16',
    });
    expect(toPublicPeriod(periods.yesterday).fromDate).toBe('2026-09-15');
  });

  it('builds this week and the whole of last week', () => {
    expect(toPublicPeriod(periods.thisWeek)).toMatchObject({
      fromDate: '2026-09-14',
      toDate: '2026-09-20',
    });
    // A like-for-like comparison needs the FULL previous week, not a partial one.
    expect(toPublicPeriod(periods.previousWeek)).toMatchObject({
      fromDate: '2026-09-07',
      toDate: '2026-09-13',
    });
  });

  it('builds this month and the whole of last month', () => {
    expect(toPublicPeriod(periods.thisMonth)).toMatchObject({
      fromDate: '2026-09-01',
      toDate: '2026-09-30',
    });
    expect(toPublicPeriod(periods.previousMonth)).toMatchObject({
      fromDate: '2026-08-01',
      toDate: '2026-08-31',
    });
  });

  it('steps to the previous month correctly from the 1st', () => {
    const fromFirst = buildPeriods(date('2026-01-01'));
    expect(toPublicPeriod(fromFirst.previousMonth)).toMatchObject({
      fromDate: '2025-12-01',
      toDate: '2025-12-31',
    });
  });

  it('never overlaps a period with its predecessor', () => {
    expect(periods.previousWeek.toDate.getTime()).toBeLessThan(periods.thisWeek.fromDate.getTime());
    expect(periods.previousMonth.toDate.getTime()).toBeLessThan(
      periods.thisMonth.fromDate.getTime(),
    );
  });
});

describe('comparing one period with another', () => {
  it('reports the change and its direction', () => {
    expect(compareValues('150', '100')).toEqual({
      current: '150.00',
      previous: '100.00',
      change: '50.00',
      changePercent: '50.00',
      direction: 'UP',
    });
  });

  it('reports a fall', () => {
    const result = compareValues('80', '100');
    expect(result.change).toBe('-20.00');
    expect(result.changePercent).toBe('-20.00');
    expect(result.direction).toBe('DOWN');
  });

  it('reports no change as flat', () => {
    expect(compareValues('100', '100').direction).toBe('FLAT');
    expect(compareValues('0', '0').direction).toBe('FLAT');
  });

  it('refuses to invent a percentage when the previous period was zero', () => {
    // "Up from nothing" has no percentage. Reporting infinity, or 100%, would be
    // a made-up number on a business dashboard.
    const result = compareValues('500', '0');
    expect(result.changePercent).toBeNull();
    expect(result.change).toBe('500.00');
    expect(result.direction).toBe('UP');
  });

  it('uses Decimal, never floating point', () => {
    expect(compareValues('0.3', '0.1').change).toBe('0.20');
    expect(compareValues('0.1', '0.2').change).toBe('-0.10');
  });

  it('treats a missing value as zero', () => {
    expect(compareValues(null, null)).toMatchObject({ current: '0.00', direction: 'FLAT' });
  });
});

describe('inventory valuation', () => {
  const balance = (quantity, averageCost, reorderLevel = '0') => ({
    quantity,
    averageCost,
    product: { reorderLevel },
  });

  it('values stock at quantity times average cost', () => {
    const result = summariseInventory([balance('10', '100'), balance('5', '200')]);

    expect(result.totalValue).toBe('2000.00');
    expect(result.itemCount).toBe(2);
  });

  it('is zero for a company with no stock', () => {
    const result = summariseInventory([]);
    expect(result.totalValue).toBe('0.00');
    expect(result.itemCount).toBe(0);
    expect(result.lowStockCount).toBe(0);
  });

  it('rounds each balance once, the way the inventory module does', () => {
    // 3 x 33.3333 = 99.9999 -> 100.00 per balance.
    const result = summariseInventory([balance('3', '33.3333')]);
    expect(result.totalValue).toBe('100.00');
  });

  it('handles a decimal quantity without floating point drift', () => {
    const result = summariseInventory([balance('0.1', '0.1'), balance('0.2', '0.1')]);
    expect(result.totalValue).toBe('0.03');
  });

  it('counts stock at or below its reorder level', () => {
    const result = summariseInventory([
      balance('5', '100', '10'),
      balance('10', '100', '10'),
      balance('50', '100', '10'),
      // A zero reorder level means "not tracked", not "everything is low".
      balance('0', '100', '0'),
    ]);

    expect(result.lowStockCount).toBe(2);
  });

  it('values stock that has gone to zero at nothing', () => {
    expect(summariseInventory([balance('0', '100')]).totalValue).toBe('0.00');
  });
});

describe('credit ageing', () => {
  it('counts whole days between two business dates', () => {
    expect(daysBetween(date('2026-09-01'), date('2026-09-16'))).toBe(15);
    expect(daysBetween(date('2026-09-16'), date('2026-09-16'))).toBe(0);
  });

  it('returns null when there is no date to age from', () => {
    expect(daysBetween(null, date('2026-09-16'))).toBeNull();
    expect(daysBetween(date('2026-09-16'), null)).toBeNull();
  });

  it('places an age in the usual buckets', () => {
    expect(ageingBucket(0)).toBe('0-30');
    expect(ageingBucket(30)).toBe('0-30');
    expect(ageingBucket(31)).toBe('31-60');
    expect(ageingBucket(60)).toBe('31-60');
    expect(ageingBucket(61)).toBe('61-90');
    expect(ageingBucket(90)).toBe('61-90');
    expect(ageingBucket(91)).toBe('90+');
    expect(ageingBucket(400)).toBe('90+');
  });

  it('names an undated debt rather than guessing its age', () => {
    expect(ageingBucket(null)).toBe('UNDATED');
  });
});
