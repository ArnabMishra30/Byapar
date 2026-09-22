import { describe, it, expect } from 'vitest';
import {
  buildExpenseLines,
  buildPurchaseLines,
} from '../../src/modules/accounting/gl-posting.service.js';
import { normalizeJournalLines } from '../../src/modules/accounting/journal.service.js';
import {
  SYSTEM_ACCOUNT,
  SYSTEM_ACCOUNTS,
  NON_CATEGORY_EXPENSE_CODES,
} from '../../src/modules/accounting/system-accounts.js';

// The expense posting rule and the category chart, tested without a database.
//
// An expense is the simplest document in the system: two lines, the same figure
// on both sides, no discount, no tax and no variance. These tests exist to keep
// it that way.

/** Runs the real validator, so balance is proved rather than assumed. */
function expectBalanced(lines) {
  const { totalDebit, totalCredit } = normalizeJournalLines(lines);
  expect(totalDebit.toFixed(4)).toBe(totalCredit.toFixed(4));
  return { totalDebit, totalCredit };
}

const lineFor = (lines, accountId) => lines.find((line) => line.accountId === accountId);

describe('the expense journal entry', () => {
  const base = {
    amount: '20000',
    expenseAccountId: 'account-rent',
    paymentAccountId: 'account-cash',
    expenseNumber: 'EXP-2026-000001',
    categoryName: 'Rent',
  };

  it('debits the category and credits the account that paid', () => {
    const lines = buildExpenseLines(base);

    expectBalanced(lines);
    expect(lines).toHaveLength(2);
    expect(lineFor(lines, 'account-rent').debit.toString()).toBe('20000');
    expect(lineFor(lines, 'account-cash').credit.toString()).toBe('20000');
  });

  it('names the account by id, not by code', () => {
    // A category may be an account the business created itself, which has no
    // system code to resolve. Both lines therefore carry an id.
    const lines = buildExpenseLines(base);

    expect(lines.every((line) => typeof line.accountId === 'string')).toBe(true);
    expect(lines.every((line) => line.accountCode === undefined)).toBe(true);
  });

  it('puts the same figure on both sides, at every amount', () => {
    for (const amount of ['0.01', '250', '4500', '20000', '1234.56', '999999.99']) {
      const { totalDebit, totalCredit } = expectBalanced(
        buildExpenseLines({ ...base, amount }),
      );
      expect(`${amount}:${totalDebit.toFixed(2)}`).toBe(`${amount}:${totalCredit.toFixed(2)}`);
    }
  });

  it('rounds once, to the stored precision', () => {
    const lines = buildExpenseLines({ ...base, amount: '100.00005' });
    expect(lineFor(lines, 'account-rent').debit.toString()).toBe('100.0001');
    expectBalanced(lines);
  });

  it('uses Decimal, never floating point', () => {
    const a = buildExpenseLines({ ...base, amount: '0.1' });
    const b = buildExpenseLines({ ...base, amount: '0.2' });
    const total = lineFor(a, 'account-rent').debit.plus(lineFor(b, 'account-rent').debit);

    expect(total.toString()).toBe('0.3');
  });

  it('describes both lines with the document number', () => {
    const lines = buildExpenseLines(base);

    expect(lineFor(lines, 'account-rent').description).toBe('Rent - EXP-2026-000001');
    expect(lineFor(lines, 'account-cash').description).toContain('EXP-2026-000001');
  });

  it('produces the entry the brief describes, for each worked example', () => {
    // Rent 20,000 from cash.
    const rent = buildExpenseLines({ ...base, amount: '20000', categoryName: 'Rent' });
    expect(lineFor(rent, 'account-rent').debit.toString()).toBe('20000');
    expect(lineFor(rent, 'account-cash').credit.toString()).toBe('20000');

    // Electricity 4,500 from bank.
    const electricity = buildExpenseLines({
      amount: '4500',
      expenseAccountId: 'account-electricity',
      paymentAccountId: 'account-bank',
      expenseNumber: 'EXP-2026-000002',
      categoryName: 'Electricity',
    });
    expect(lineFor(electricity, 'account-electricity').debit.toString()).toBe('4500');
    expect(lineFor(electricity, 'account-bank').credit.toString()).toBe('4500');

    // Bank charges 250.
    const charges = buildExpenseLines({
      amount: '250',
      expenseAccountId: 'account-bank-charges',
      paymentAccountId: 'account-bank',
      expenseNumber: 'EXP-2026-000003',
      categoryName: 'Bank Charges',
    });
    expect(lineFor(charges, 'account-bank-charges').debit.toString()).toBe('250');
    expect(lineFor(charges, 'account-bank').credit.toString()).toBe('250');

    for (const lines of [rent, electricity, charges]) expectBalanced(lines);
  });

  it('is rejected by the validator when the amount is zero', () => {
    // A zero line is not a valid journal line, so a zero expense cannot post at
    // all - it would claim an effect that did not happen.
    expect(() => normalizeJournalLines(buildExpenseLines({ ...base, amount: '0' }))).toThrowError(
      /at least two lines/i,
    );
  });

  it('carries no tax, no discount and no variance', () => {
    const lines = buildExpenseLines(base);
    const purchase = buildPurchaseLines({
      inventoryValue: '1000',
      taxTotal: '180',
      grandTotal: '1180',
      purchaseNumber: 'PUR-1',
    });

    // A purchase has tax and possibly a variance line. An expense has neither.
    expect(lines).toHaveLength(2);
    expect(purchase.length).toBeGreaterThan(2);
  });
});

describe('the expense category chart', () => {
  const categories = SYSTEM_ACCOUNTS.filter(
    (account) => account.parentCode === SYSTEM_ACCOUNT.OPERATING_EXPENSES,
  );

  it('covers every category the brief asks for', () => {
    const names = categories.map((account) => account.name);

    for (const expected of [
      'Rent',
      'Electricity',
      'Water',
      'Internet & Telephone',
      'Salaries & Wages',
      'Transportation',
      'Repairs & Maintenance',
      'Office Expenses',
      'Packaging',
      'Advertising & Marketing',
      'Bank Charges',
      'Professional Fees',
      'Insurance',
      'Miscellaneous Expenses',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('makes every category an EXPENSE account under Operating Expenses', () => {
    expect(categories).toHaveLength(14);
    expect(categories.every((account) => account.type === 'EXPENSE')).toBe(true);
    expect(categories.every((account) => account.code.startsWith('52'))).toBe(true);
  });

  it('gives every account a unique code', () => {
    const codes = SYSTEM_ACCOUNTS.map((account) => account.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('protects the accounts other flows maintain from being used as a category', () => {
    // Posting rent to Cost of Goods Sold would silently corrupt gross profit,
    // which is the number a shopkeeper trusts most.
    expect(NON_CATEGORY_EXPENSE_CODES).toContain(SYSTEM_ACCOUNT.COST_OF_GOODS_SOLD);
    expect(NON_CATEGORY_EXPENSE_CODES).toContain(SYSTEM_ACCOUNT.INVENTORY_VALUATION_ADJUSTMENT);
    // And the grouping parent, which nothing posts to directly.
    expect(NON_CATEGORY_EXPENSE_CODES).toContain(SYSTEM_ACCOUNT.OPERATING_EXPENSES);
  });

  it('never excludes a real category', () => {
    for (const account of categories) {
      expect(NON_CATEGORY_EXPENSE_CODES).not.toContain(account.code);
    }
  });

  it('identifies categories by code, never by name', () => {
    // A business may rename "Rent" to anything it likes. Nothing in the posting
    // logic may depend on the word.
    expect(NON_CATEGORY_EXPENSE_CODES.every((code) => /^\d+$/.test(code))).toBe(true);
  });
});
