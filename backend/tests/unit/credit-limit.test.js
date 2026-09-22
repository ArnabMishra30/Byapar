import { describe, it, expect } from 'vitest';
import {
  deriveCreditPosition,
  isUnlimited,
  toPublicCreditTerms,
} from '../../src/modules/credit/credit-limit.service.js';
import { overdueBucket, daysBetween, BUCKET_ORDER } from '../../src/modules/credit/collections.service.js';
import { resolveDueDate } from '../../src/modules/sales/sales.service.js';
import { resolveDueDate as resolvePurchaseDueDate } from '../../src/modules/purchases/purchase.service.js';

// The credit rules, tested as arithmetic - no database, no HTTP.
//
// Every figure here is small enough to check by hand, which is the point: a
// credit limit refuses a sale, and a rule that refuses a sale has to be a rule
// anyone can verify by reading it.

const position = (creditLimit, outstanding, newExposure = 0) =>
  deriveCreditPosition({ creditLimit, outstanding, newExposure });

describe('a credit limit of zero', () => {
  it('1. means unlimited, not "no credit allowed"', () => {
    // Every customer in every existing company carries the schema default of 0.
    // Reading it as "no credit" would refuse every sale ever made.
    expect(isUnlimited('0')).toBe(true);
    expect(isUnlimited('0.00')).toBe(true);
    expect(isUnlimited(null)).toBe(true);
    expect(isUnlimited(undefined)).toBe(true);
    expect(isUnlimited('0.01')).toBe(false);
  });

  it('2. never blocks a sale, however large', () => {
    const huge = position('0', '9999999', '9999999');

    expect(huge.isUnlimited).toBe(true);
    expect(huge.wouldExceed).toBe(false);
    expect(huge.exceededBy).toBe('0.00');
  });

  it('3. reports no available credit figure rather than zero', () => {
    // Null says "there is no limit". Zero would say "you have none left", which
    // is the opposite of the truth.
    const unlimited = position('0', '5000');

    expect(unlimited.availableCredit).toBeNull();
    expect(unlimited.utilisationPercent).toBeNull();
  });
});

describe('available credit', () => {
  it('4. is the limit less what is owed', () => {
    expect(position('10000', '4000').availableCredit).toBe('6000.00');
    expect(position('10000', '0').availableCredit).toBe('10000.00');
    expect(position('10000', '10000').availableCredit).toBe('0.00');
  });

  it('5. never goes negative when a customer is already over', () => {
    const over = position('10000', '13000');

    expect(over.availableCredit).toBe('0.00');
    expect(over.outstanding).toBe('13000.00');
  });

  it('6. never exceeds the limit when the customer is in advance', () => {
    // They have paid 2,000 more than they owe. That is their money, not extra
    // credit: available stays at the limit.
    const inAdvance = position('10000', '-2000');

    expect(inAdvance.availableCredit).toBe('10000.00');
    expect(inAdvance.utilisationPercent).toBe('0.00');
  });

  it('7. is computed in Decimal, not floating point', () => {
    const a = position('0.30', '0.10');
    expect(a.availableCredit).toBe('0.20');

    const b = position('1000000000.05', '0.05');
    expect(b.availableCredit).toBe('1000000000.00');
  });
});

describe('utilisation', () => {
  it('8. is used over limit, as a percentage', () => {
    expect(position('10000', '2500').utilisationPercent).toBe('25.00');
    expect(position('10000', '10000').utilisationPercent).toBe('100.00');
    expect(position('3000', '1000').utilisationPercent).toBe('33.33');
  });

  it('9. clamps at 100 rather than reporting 130%', () => {
    // The bar is full. `exceededBy` carries how far past.
    expect(position('10000', '13000').utilisationPercent).toBe('100.00');
  });

  it('10. is zero, not negative, for a customer in advance', () => {
    expect(position('10000', '-5000').utilisationPercent).toBe('0.00');
  });
});

describe('whether a new invoice fits', () => {
  it('11. allows an invoice that lands exactly on the limit', () => {
    const exact = position('10000', '4000', '6000');

    expect(exact.projectedOutstanding).toBe('10000.00');
    expect(exact.wouldExceed).toBe(false);
  });

  it('12. refuses an invoice one paisa over', () => {
    const over = position('10000', '4000', '6000.01');

    expect(over.projectedOutstanding).toBe('10000.01');
    expect(over.wouldExceed).toBe(true);
    expect(over.exceededBy).toBe('0.01');
  });

  it('13. says exactly how far over it would be', () => {
    const over = position('10000', '4000', '9000');

    expect(over.projectedOutstanding).toBe('13000.00');
    expect(over.exceededBy).toBe('3000.00');
  });

  it('14. counts an advance against the new invoice', () => {
    // They are 5,000 in credit and the limit is 10,000, so a 14,000 invoice
    // still fits: they would owe 9,000.
    const withAdvance = position('10000', '-5000', '14000');

    expect(withAdvance.projectedOutstanding).toBe('9000.00');
    expect(withAdvance.wouldExceed).toBe(false);
  });

  it('15. reports nothing exceeded when nothing is', () => {
    expect(position('10000', '1000', '1000').exceededBy).toBe('0.00');
  });
});

describe('credit terms on a party', () => {
  it('16. publishes the limit, whether it is a limit, and the days', () => {
    expect(toPublicCreditTerms({ creditLimit: '25000', creditDays: 30 })).toEqual({
      creditLimit: '25000.00',
      isUnlimited: false,
      creditDays: 30,
    });

    expect(toPublicCreditTerms({ creditLimit: '0', creditDays: null })).toEqual({
      creditLimit: '0.00',
      isUnlimited: true,
      creditDays: null,
    });
  });
});

describe('the due date an invoice carries', () => {
  const invoiceDate = new Date('2026-09-01T00:00:00.000Z');

  it('17. uses an explicit date whenever one is given', () => {
    const explicit = new Date('2026-09-20T00:00:00.000Z');

    // Terms are a default, not a rule: someone typed this date on purpose.
    expect(resolveDueDate({ invoiceDate, dueDate: explicit, creditDays: 30 })).toBe(explicit);
  });

  it('18. derives one from the credit terms when none is given', () => {
    const derived = resolveDueDate({ invoiceDate, dueDate: null, creditDays: 30 });
    expect(derived.toISOString().slice(0, 10)).toBe('2026-10-01');
  });

  it('19. treats zero days as due on the invoice date', () => {
    const derived = resolveDueDate({ invoiceDate, dueDate: null, creditDays: 0 });
    expect(derived.toISOString().slice(0, 10)).toBe('2026-09-01');
  });

  it('20. leaves the invoice undated when there are no terms', () => {
    // An undated invoice is outstanding but never overdue: nobody agreed a date,
    // so nothing has been missed.
    expect(resolveDueDate({ invoiceDate, dueDate: null, creditDays: null })).toBeNull();
    expect(resolveDueDate({ invoiceDate, dueDate: null, creditDays: undefined })).toBeNull();
  });

  it('21. crosses a month and a year boundary correctly', () => {
    const yearEnd = new Date('2026-12-20T00:00:00.000Z');
    expect(
      resolveDueDate({ invoiceDate: yearEnd, dueDate: null, creditDays: 45 })
        .toISOString()
        .slice(0, 10),
    ).toBe('2027-02-03');
  });

  it('22. applies the identical rule on the supplier side', () => {
    const derived = resolvePurchaseDueDate({ invoiceDate, dueDate: null, creditDays: 15 });
    expect(derived.toISOString().slice(0, 10)).toBe('2026-09-16');
    expect(resolvePurchaseDueDate({ invoiceDate, dueDate: null, creditDays: null })).toBeNull();
  });
});

describe('overdue ageing', () => {
  it('23. buckets by days past DUE, not by document age', () => {
    // "60 days old" and "60 days late" are different questions, and a
    // collections list is asking the second.
    expect(overdueBucket(-5)).toBe('NOT_DUE');
    expect(overdueBucket(0)).toBe('NOT_DUE');
    expect(overdueBucket(1)).toBe('1-30');
    expect(overdueBucket(30)).toBe('1-30');
    expect(overdueBucket(31)).toBe('31-60');
    expect(overdueBucket(60)).toBe('31-60');
    expect(overdueBucket(61)).toBe('61-90');
    expect(overdueBucket(90)).toBe('61-90');
    expect(overdueBucket(91)).toBe('90+');
    expect(overdueBucket(3650)).toBe('90+');
  });

  it('24. gives an undated invoice its own bucket', () => {
    // Not folded into NOT_DUE: "not late" and "no date was ever agreed" are
    // different facts, and a collections clerk needs to tell them apart.
    expect(overdueBucket(null)).toBe('UNDATED');
    expect(BUCKET_ORDER).toContain('UNDATED');
    expect(BUCKET_ORDER).toContain('NOT_DUE');
  });

  it('25. orders the buckets from soonest to latest', () => {
    expect(BUCKET_ORDER).toEqual(['NOT_DUE', '1-30', '31-60', '61-90', '90+', 'UNDATED']);
  });

  it('26. counts whole days between two business dates', () => {
    const due = new Date('2026-09-01T00:00:00.000Z');

    expect(daysBetween(due, new Date('2026-09-01T00:00:00.000Z'))).toBe(0);
    expect(daysBetween(due, new Date('2026-09-15T00:00:00.000Z'))).toBe(14);
    expect(daysBetween(due, new Date('2026-08-25T00:00:00.000Z'))).toBe(-7);
    expect(daysBetween(null, due)).toBeNull();
    expect(daysBetween(due, null)).toBeNull();
  });
});
