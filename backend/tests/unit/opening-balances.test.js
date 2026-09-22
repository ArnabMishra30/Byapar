import { describe, it, expect } from 'vitest';
import { buildOpeningLines } from '../../src/modules/opening-balances/opening-balance.service.js';
import { normalizeJournalLines } from '../../src/modules/accounting/journal.service.js';
import { SYSTEM_ACCOUNT } from '../../src/modules/accounting/system-accounts.js';

// The opening-balance journal, as arithmetic - no database, no HTTP.
//
// The figures are the ones from the brief, so every total can be checked by hand:
//
//   Cash 50,000 + Bank 1,00,000 + Inventory 2,00,000 + Customer dues 75,000
//     less Supplier dues 60,000
//     = Opening capital 3,65,000

const AS_OF = new Date('2026-04-01T00:00:00.000Z');

/** Runs the real validator, so balance is proved rather than asserted. */
function expectBalanced(lines) {
  const { totalDebit, totalCredit } = normalizeJournalLines(lines);
  expect(totalDebit.toFixed(4)).toBe(totalCredit.toFixed(4));
  return { totalDebit, totalCredit };
}

const lineFor = (lines, code) => lines.find((line) => line.accountCode === code);

const opening = (overrides = {}) =>
  buildOpeningLines({ asOfDate: AS_OF, ...overrides });

describe('the opening balance journal', () => {
  const full = () =>
    opening({
      cash: '50000',
      bankAccounts: [],
      bankByAccountId: [{ accountCode: SYSTEM_ACCOUNT.BANK, amount: '100000' }],
      inventoryValue: '200000',
      receivableTotal: '75000',
      payableTotal: '60000',
    });

  it('1. balances, with capital as the difference', () => {
    const lines = full();
    const { totalDebit } = expectBalanced(lines);

    // 50,000 + 1,00,000 + 2,00,000 + 75,000 = 4,25,000 of debits.
    expect(totalDebit.toFixed(2)).toBe('425000.00');
    // 60,000 payable + 3,65,000 capital = 4,25,000 of credits.
    expect(lineFor(lines, SYSTEM_ACCOUNT.OWNERS_CAPITAL).credit.toFixed(2)).toBe('365000.00');
  });

  it('2. debits every asset and credits every liability', () => {
    const lines = full();

    expect(lineFor(lines, SYSTEM_ACCOUNT.CASH).debit.toFixed(2)).toBe('50000.00');
    expect(lineFor(lines, SYSTEM_ACCOUNT.BANK).debit.toFixed(2)).toBe('100000.00');
    expect(lineFor(lines, SYSTEM_ACCOUNT.INVENTORY).debit.toFixed(2)).toBe('200000.00');
    expect(lineFor(lines, SYSTEM_ACCOUNT.ACCOUNTS_RECEIVABLE).debit.toFixed(2)).toBe('75000.00');
    expect(lineFor(lines, SYSTEM_ACCOUNT.ACCOUNTS_PAYABLE).credit.toFixed(2)).toBe('60000.00');
  });

  it('3. never touches a revenue, expense or tax account', () => {
    // This is the whole point. An opening balance is not a sale, not a purchase
    // and not an expense, so none of those accounts may appear.
    const codes = full().map((line) => line.accountCode ?? line.accountId);

    for (const forbidden of [
      SYSTEM_ACCOUNT.SALES_REVENUE,
      SYSTEM_ACCOUNT.SALES_RETURNS,
      SYSTEM_ACCOUNT.COST_OF_GOODS_SOLD,
      SYSTEM_ACCOUNT.OPERATING_EXPENSES,
      SYSTEM_ACCOUNT.INPUT_TAX_CREDIT,
      SYSTEM_ACCOUNT.TAX_PAYABLE,
      SYSTEM_ACCOUNT.INPUT_CGST,
      SYSTEM_ACCOUNT.OUTPUT_IGST,
    ]) {
      expect(codes).not.toContain(forbidden);
    }
  });

  it('4. balances for cash alone', () => {
    const lines = opening({ cash: '50000' });

    expectBalanced(lines);
    expect(lines).toHaveLength(2);
    expect(lineFor(lines, SYSTEM_ACCOUNT.CASH).debit.toFixed(2)).toBe('50000.00');
    expect(lineFor(lines, SYSTEM_ACCOUNT.OWNERS_CAPITAL).credit.toFixed(2)).toBe('50000.00');
  });

  it('5. debits capital when liabilities exceed assets', () => {
    // A business that owes more than it holds is a real situation, and the entry
    // must still balance rather than being refused or plugged.
    const lines = opening({ cash: '10000', payableTotal: '25000' });

    expectBalanced(lines);
    expect(lineFor(lines, SYSTEM_ACCOUNT.OWNERS_CAPITAL).debit.toFixed(2)).toBe('15000.00');
    expect(lineFor(lines, SYSTEM_ACCOUNT.OWNERS_CAPITAL).credit).toBeUndefined();
  });

  it('6. writes no capital line when assets exactly equal liabilities', () => {
    const lines = opening({ cash: '25000', payableTotal: '25000' });

    expectBalanced(lines);
    expect(lineFor(lines, SYSTEM_ACCOUNT.OWNERS_CAPITAL)).toBeUndefined();
    expect(lines).toHaveLength(2);
  });

  it('7. drops a zero balance rather than writing an empty line', () => {
    const lines = opening({ cash: '50000', inventoryValue: '0', receivableTotal: '0' });

    expect(lineFor(lines, SYSTEM_ACCOUNT.INVENTORY)).toBeUndefined();
    expect(lineFor(lines, SYSTEM_ACCOUNT.ACCOUNTS_RECEIVABLE)).toBeUndefined();
    expectBalanced(lines);
  });

  it('8. gives each named bank account its own line', () => {
    // A business with three banks must see three balances, not one meaningless
    // total that reconciles to nothing.
    const lines = opening({
      bankByAccountId: [
        { accountId: 'account-hdfc', amount: '60000' },
        { accountId: 'account-sbi', amount: '40000' },
      ],
    });

    expectBalanced(lines);
    const hdfc = lines.find((line) => line.accountId === 'account-hdfc');
    const sbi = lines.find((line) => line.accountId === 'account-sbi');

    expect(hdfc.debit.toFixed(2)).toBe('60000.00');
    expect(sbi.debit.toFixed(2)).toBe('40000.00');
    expect(lineFor(lines, SYSTEM_ACCOUNT.OWNERS_CAPITAL).credit.toFixed(2)).toBe('100000.00');
  });

  it('9. falls back to the system Bank account when none is named', () => {
    const lines = opening({ bankByAccountId: [{ accountCode: SYSTEM_ACCOUNT.BANK, amount: '75000' }] });

    expect(lineFor(lines, SYSTEM_ACCOUNT.BANK).debit.toFixed(2)).toBe('75000.00');
    expectBalanced(lines);
  });

  it('10. balances at every scale, in Decimal', () => {
    for (const cash of ['0.01', '1234.56', '999999.99', '10000000.55']) {
      const { totalDebit, totalCredit } = expectBalanced(opening({ cash }));
      expect(`${cash}:${totalDebit.toFixed(2)}`).toBe(`${cash}:${totalCredit.toFixed(2)}`);
    }
  });

  it('11. does not drift through floating point', () => {
    // 0.1 + 0.2 must be 0.3 here, as everywhere else money is handled.
    const lines = opening({ cash: '0.1', inventoryValue: '0.2' });
    const capital = lineFor(lines, SYSTEM_ACCOUNT.OWNERS_CAPITAL);

    expect(capital.credit.toString()).toBe('0.3');
    expectBalanced(lines);
  });

  it('12. rounds once, to the stored precision', () => {
    const lines = opening({ cash: '100.00005' });

    expect(lineFor(lines, SYSTEM_ACCOUNT.CASH).debit.toString()).toBe('100.0001');
    expectBalanced(lines);
  });

  it('13. carries the as-of date into every line description', () => {
    const lines = opening({ cash: '50000', payableTotal: '1000' });

    expect(lines.every((line) => line.description.includes('2026-04-01'))).toBe(true);
    expect(lineFor(lines, SYSTEM_ACCOUNT.CASH).description).toContain('Opening cash');
  });

  it('14. produces nothing at all when there is nothing to record', () => {
    // An empty initialization writes no lines, and the posting service refuses
    // an entry with none - so an empty opening can never reach the ledger.
    const lines = opening({});

    expect(lines).toHaveLength(0);
    expect(() => normalizeJournalLines(lines)).toThrowError(/at least two lines/i);
  });

  it('15. matches the brief worked example, to the paisa', () => {
    const lines = opening({
      cash: '50000',
      bankByAccountId: [{ accountCode: SYSTEM_ACCOUNT.BANK, amount: '100000' }],
      inventoryValue: '200000',
      receivableTotal: '75000',
      payableTotal: '60000',
    });

    const { totalDebit, totalCredit } = expectBalanced(lines);

    expect(totalDebit.toFixed(2)).toBe('425000.00');
    expect(totalCredit.toFixed(2)).toBe('425000.00');
    // Assets 4,25,000 less liabilities 60,000.
    expect(lineFor(lines, SYSTEM_ACCOUNT.OWNERS_CAPITAL).credit.toFixed(2)).toBe('365000.00');
  });
});
