import { describe, it, expect } from 'vitest';
import {
  createPeriodSchema,
  reopenPeriodSchema,
  checkDateQuerySchema,
} from '../../src/modules/periods/period.validation.js';
import { initializeOpeningBalancesSchema } from '../../src/modules/opening-balances/opening-balance.validation.js';

// Period and opening-balance validation, as pure schema behaviour.
//
// The overlap rule itself needs two rows and so is an integration concern; what
// is testable here is that a range, a date and an amount are all checked before
// anything reaches the database.

const parse = (schema, value) => schema.safeParse(value);
const ok = (schema, value) => parse(schema, value).success;
const errors = (schema, value) =>
  parse(schema, value).error?.issues.map((issue) => issue.message) ?? [];

const period = (overrides = {}) => ({
  name: 'March 2026',
  startDate: '2026-03-01',
  endDate: '2026-03-31',
  ...overrides,
});

describe('creating a period', () => {
  it('1. accepts a well-formed range', () => {
    const parsed = parse(createPeriodSchema, period());

    expect(parsed.success).toBe(true);
    // Dates become the UTC-midnight Dates the business columns store.
    expect(parsed.data.startDate.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(parsed.data.endDate.toISOString()).toBe('2026-03-31T00:00:00.000Z');
  });

  it('2. accepts a single-day period', () => {
    expect(ok(createPeriodSchema, period({ startDate: '2026-03-15', endDate: '2026-03-15' }))).toBe(
      true,
    );
  });

  it('3. refuses a range that ends before it starts', () => {
    const result = parse(createPeriodSchema, period({ startDate: '2026-03-31', endDate: '2026-03-01' }));

    expect(result.success).toBe(false);
    expect(errors(createPeriodSchema, period({ startDate: '2026-03-31', endDate: '2026-03-01' }))).toContain(
      'A period cannot end before it starts',
    );
  });

  it('4. refuses a malformed or impossible date', () => {
    expect(ok(createPeriodSchema, period({ startDate: '01-03-2026' }))).toBe(false);
    expect(ok(createPeriodSchema, period({ startDate: '2026-3-1' }))).toBe(false);
    expect(ok(createPeriodSchema, period({ endDate: '2026-02-30' }))).toBe(false);
  });

  it('5. requires a name, and refuses an empty one', () => {
    const noName = period();
    delete noName.name;

    expect(ok(createPeriodSchema, noName)).toBe(false);
    expect(ok(createPeriodSchema, period({ name: '   ' }))).toBe(false);
    expect(ok(createPeriodSchema, period({ name: 'x'.repeat(101) }))).toBe(false);
  });

  it('6. refuses an unknown field rather than ignoring it', () => {
    // A caller sending `status: "CLOSED"` on creation is asking for something
    // the endpoint does not do. Silently dropping it would be worse.
    expect(ok(createPeriodSchema, { ...period(), status: 'CLOSED' })).toBe(false);
  });

  it('7. crosses a year boundary', () => {
    expect(ok(createPeriodSchema, period({ startDate: '2026-12-01', endDate: '2027-01-31' }))).toBe(
      true,
    );
  });
});

describe('reopening a period', () => {
  it('8. works with no body at all', () => {
    // Reopening normally carries no body, and must keep working that way.
    expect(ok(reopenPeriodSchema, undefined)).toBe(true);
    expect(ok(reopenPeriodSchema, {})).toBe(true);
  });

  it('9. accepts a reason and refuses an empty one', () => {
    expect(ok(reopenPeriodSchema, { reason: 'Closed the wrong month' })).toBe(true);
    expect(ok(reopenPeriodSchema, { reason: '   ' })).toBe(false);
    expect(ok(reopenPeriodSchema, { reason: 'x'.repeat(501) })).toBe(false);
  });

  it('10. refuses an unknown field', () => {
    expect(ok(reopenPeriodSchema, { force: true })).toBe(false);
  });
});

describe('checking whether a date can be posted', () => {
  it('11. requires a valid business date', () => {
    expect(ok(checkDateQuerySchema, { date: '2026-03-15' })).toBe(true);
    expect(ok(checkDateQuerySchema, { date: '15/03/2026' })).toBe(false);
    expect(ok(checkDateQuerySchema, {})).toBe(false);
  });
});

describe('opening balance input', () => {
  const opening = (overrides = {}) => ({ asOfDate: '2026-04-01', ...overrides });

  it('12. requires an as-of date', () => {
    expect(ok(initializeOpeningBalancesSchema, {})).toBe(false);
    expect(ok(initializeOpeningBalancesSchema, opening({ cash: '50000' }))).toBe(true);
  });

  it('13. takes cash, banks, parties and stock together', () => {
    const parsed = parse(
      initializeOpeningBalancesSchema,
      opening({
        cash: '50000',
        bankAccounts: [{ amount: '100000' }],
        customers: [{ customerId: '11111111-1111-1111-1111-111111111111', amount: '12000' }],
        suppliers: [{ supplierId: '22222222-2222-2222-2222-222222222222', amount: '25000' }],
        inventory: [
          {
            productId: '33333333-3333-3333-3333-333333333333',
            warehouseId: '44444444-4444-4444-4444-444444444444',
            quantity: '40',
            unitCost: '1100',
          },
        ],
      }),
    );

    expect(parsed.success).toBe(true);
    expect(parsed.data.asOfDate.toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });

  it('14. refuses a party id that is not a uuid', () => {
    expect(
      ok(initializeOpeningBalancesSchema, opening({ customers: [{ customerId: 'nope', amount: '1' }] })),
    ).toBe(false);
  });

  it('15. refuses more than two decimal places on money', () => {
    expect(ok(initializeOpeningBalancesSchema, opening({ cash: '50000.123' }))).toBe(false);
    expect(ok(initializeOpeningBalancesSchema, opening({ cash: '50000.12' }))).toBe(true);
  });

  it('16. lets an opening due carry a date, so it ages like any other', () => {
    expect(
      ok(
        initializeOpeningBalancesSchema,
        opening({
          customers: [
            {
              customerId: '11111111-1111-1111-1111-111111111111',
              amount: '12000',
              dueDate: '2026-03-01',
              reference: 'Bill book page 14',
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it('17. requires both a product and a warehouse on every stock line', () => {
    const line = {
      productId: '33333333-3333-3333-3333-333333333333',
      warehouseId: '44444444-4444-4444-4444-444444444444',
      quantity: '40',
      unitCost: '1100',
    };

    for (const missing of ['productId', 'warehouseId', 'quantity', 'unitCost']) {
      const broken = { ...line };
      delete broken[missing];
      expect(`${missing}:${ok(initializeOpeningBalancesSchema, opening({ inventory: [broken] }))}`).toBe(
        `${missing}:false`,
      );
    }
  });

  it('18. allows a zero unit cost, because a free sample is real stock', () => {
    expect(
      ok(
        initializeOpeningBalancesSchema,
        opening({
          inventory: [
            {
              productId: '33333333-3333-3333-3333-333333333333',
              warehouseId: '44444444-4444-4444-4444-444444444444',
              quantity: '10',
              unitCost: '0',
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it('19. refuses an unknown field rather than ignoring it', () => {
    expect(ok(initializeOpeningBalancesSchema, opening({ openingEquity: '365000' }))).toBe(false);
    // Capital is DERIVED - assets less liabilities - and letting a caller state
    // it would let them state a figure that does not balance.
  });

  it('20. asks for no GST field anywhere', () => {
    // The schema is the contract. If it never mentions GST, a non-GST shop can
    // never be blocked by it.
    const shape = JSON.stringify(Object.keys(initializeOpeningBalancesSchema.shape ?? {}));
    expect(shape).not.toMatch(/gst|hsn|placeOfSupply|stateCode|tax/i);

    // And a complete non-GST initialization parses cleanly.
    expect(
      ok(
        initializeOpeningBalancesSchema,
        opening({
          cash: '50000',
          bankAccounts: [{ amount: '100000' }],
          customers: [{ customerId: '11111111-1111-1111-1111-111111111111', amount: '12000' }],
          suppliers: [{ supplierId: '22222222-2222-2222-2222-222222222222', amount: '25000' }],
        }),
      ),
    ).toBe(true);
  });
});
