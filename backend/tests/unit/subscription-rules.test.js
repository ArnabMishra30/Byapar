import { describe, it, expect } from 'vitest';
import {
  addDuration,
  resolveStartDate,
  resolvePeriod,
  deriveStatus,
  isEntitled,
  daysRemaining,
  toBusinessDate,
  toDateString,
} from '../../src/modules/platform/subscription.rules.js';

// The date arithmetic a shop's money depends on. Every one of these is a rule
// somebody paid for, so each is tested on its own, without a database.

const d = (value) => toBusinessDate(value);

describe('addDuration', () => {
  it('adds whole months', () => {
    expect(toDateString(addDuration(d('2026-01-15'), 3, 'MONTH'))).toBe('2026-04-15');
  });

  it('adds days', () => {
    expect(toDateString(addDuration(d('2026-01-15'), 30, 'DAY'))).toBe('2026-02-14');
  });

  it('adds years', () => {
    expect(toDateString(addDuration(d('2026-01-15'), 1, 'YEAR'))).toBe('2027-01-15');
  });

  // THE ONE THAT MATTERS. A naive setUTCMonth turns 31 Jan + 1 month into
  // 3 March, quietly handing the shop two extra days on every single renewal.
  it('clamps to the last day of a shorter month rather than rolling forward', () => {
    expect(toDateString(addDuration(d('2026-01-31'), 1, 'MONTH'))).toBe('2026-02-28');
  });

  it('clamps into a leap February', () => {
    expect(toDateString(addDuration(d('2028-01-31'), 1, 'MONTH'))).toBe('2028-02-29');
  });

  it('clamps 31 May to 30 June', () => {
    expect(toDateString(addDuration(d('2026-05-31'), 1, 'MONTH'))).toBe('2026-06-30');
  });

  it('crosses a year boundary', () => {
    expect(toDateString(addDuration(d('2026-11-15'), 3, 'MONTH'))).toBe('2027-02-15');
  });
});

describe('resolveStartDate', () => {
  const today = d('2026-06-15');

  it('starts today when the shop has never had a subscription', () => {
    expect(toDateString(resolveStartDate(today, null))).toBe('2026-06-15');
  });

  // THE RULE THAT PROTECTS THE SHOP: renewing early must not delete the days
  // already paid for.
  it('starts the day after a running subscription ends', () => {
    const current = { endDate: d('2026-08-31'), status: 'ACTIVE' };
    expect(toDateString(resolveStartDate(today, current))).toBe('2026-09-01');
  });

  it('starts today when the previous subscription already lapsed', () => {
    const current = { endDate: d('2026-05-01'), status: 'EXPIRED' };
    expect(toDateString(resolveStartDate(today, current))).toBe('2026-06-15');
  });

  it('starts today after a cancellation, however far off its end date was', () => {
    const current = { endDate: d('2027-12-31'), status: 'CANCELLED' };
    expect(toDateString(resolveStartDate(today, current))).toBe('2026-06-15');
  });

  it('starts tomorrow when the current subscription ends today', () => {
    const current = { endDate: d('2026-06-15'), status: 'ACTIVE' };
    expect(toDateString(resolveStartDate(today, current))).toBe('2026-06-16');
  });
});

describe('resolvePeriod', () => {
  const today = d('2026-06-01');
  const threeMonths = { durationValue: 3, durationUnit: 'MONTH' };

  it('ends on an inclusive last day', () => {
    const { startDate, endDate } = resolvePeriod(today, null, threeMonths);
    expect(toDateString(startDate)).toBe('2026-06-01');
    // 1 June + 3 months = 1 September, minus one day.
    expect(toDateString(endDate)).toBe('2026-08-31');
  });

  it('gives a one-month plan the whole month', () => {
    const { startDate, endDate } = resolvePeriod(d('2026-09-01'), null, {
      durationValue: 1,
      durationUnit: 'MONTH',
    });
    expect(toDateString(startDate)).toBe('2026-09-01');
    expect(toDateString(endDate)).toBe('2026-09-30');
  });

  it('stacks a renewal onto the end of a running subscription', () => {
    const current = { endDate: d('2026-07-31'), status: 'ACTIVE' };
    const { startDate, endDate } = resolvePeriod(today, current, threeMonths);
    expect(toDateString(startDate)).toBe('2026-08-01');
    expect(toDateString(endDate)).toBe('2026-10-31');
  });

  it('gives a 6-month plan six whole months', () => {
    const { startDate, endDate } = resolvePeriod(d('2026-01-01'), null, {
      durationValue: 6,
      durationUnit: 'MONTH',
    });
    expect(toDateString(startDate)).toBe('2026-01-01');
    expect(toDateString(endDate)).toBe('2026-06-30');
  });
});

describe('deriveStatus and isEntitled', () => {
  const today = d('2026-06-15');

  it('is ACTIVE while the end date is in the future', () => {
    expect(deriveStatus({ endDate: d('2026-07-01'), status: 'ACTIVE' }, today)).toBe('ACTIVE');
  });

  it('is ACTIVE on the last day itself, because the end date is inclusive', () => {
    expect(deriveStatus({ endDate: d('2026-06-15'), status: 'ACTIVE' }, today)).toBe('ACTIVE');
  });

  it('is EXPIRED the day after the end date', () => {
    expect(deriveStatus({ endDate: d('2026-06-14'), status: 'ACTIVE' }, today)).toBe('EXPIRED');
  });

  it('stays CANCELLED regardless of dates, because time does not undo a decision', () => {
    expect(deriveStatus({ endDate: d('2027-01-01'), status: 'CANCELLED' }, today)).toBe('CANCELLED');
  });

  it('entitles an active subscription and refuses an expired one', () => {
    expect(isEntitled({ endDate: d('2026-07-01'), status: 'ACTIVE' }, today)).toBe(true);
    expect(isEntitled({ endDate: d('2026-01-01'), status: 'ACTIVE' }, today)).toBe(false);
    expect(isEntitled(null, today)).toBe(false);
  });
});

describe('daysRemaining', () => {
  const today = d('2026-06-15');

  it('counts the days left', () => {
    expect(daysRemaining({ endDate: d('2026-06-25') }, today)).toBe(10);
  });

  it('is zero on the last day', () => {
    expect(daysRemaining({ endDate: d('2026-06-15') }, today)).toBe(0);
  });

  it('goes negative once the subscription has lapsed', () => {
    expect(daysRemaining({ endDate: d('2026-06-10') }, today)).toBe(-5);
  });
});
