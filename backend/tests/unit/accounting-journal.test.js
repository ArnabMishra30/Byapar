import { describe, it, expect } from 'vitest';
import {
  normalizeJournalLines,
  deriveAccountBalance,
  normalBalanceSide,
} from '../../src/modules/accounting/journal.service.js';
import {
  buildPurchaseLines,
  buildPurchaseReturnLines,
  buildSupplierPaymentLines,
  buildSalesLines,
  buildSalesReturnLines,
  buildCustomerPaymentLines,
  cashOrBankAccount,
  sumMovementCost,
} from '../../src/modules/accounting/gl-posting.service.js';
import { SYSTEM_ACCOUNT, SYSTEM_ACCOUNTS } from '../../src/modules/accounting/system-accounts.js';

// Pure double-entry rules, tested without a database.
//
// The single most valuable assertion in this file is `expectBalanced`: it runs
// every document's real line builder through the real validator, so an
// unbalanced journal for any document shape fails here rather than in production.

/** Runs the real validator and returns the totals, so balance is never assumed. */
function expectBalanced(lines) {
  const { totalDebit, totalCredit } = normalizeJournalLines(lines);
  expect(totalDebit.toFixed(4)).toBe(totalCredit.toFixed(4));
  return { totalDebit, totalCredit };
}

/** The amount posted to one account code, on one side. */
function amountOn(lines, code, side) {
  const line = lines.find((entry) => entry.accountCode === code);
  return line ? (line[side] ?? '0').toString() : null;
}

describe('the debit/credit sign convention', () => {
  it('treats debit as increasing assets and expenses', () => {
    expect(deriveAccountBalance('ASSET', 1000, 400).toString()).toBe('600');
    expect(deriveAccountBalance('EXPENSE', 250, 50).toString()).toBe('200');
    expect(normalBalanceSide('ASSET')).toBe('DEBIT');
    expect(normalBalanceSide('EXPENSE')).toBe('DEBIT');
  });

  it('treats credit as increasing liabilities, equity and revenue', () => {
    expect(deriveAccountBalance('LIABILITY', 400, 1000).toString()).toBe('600');
    expect(deriveAccountBalance('EQUITY', 0, 5000).toString()).toBe('5000');
    expect(deriveAccountBalance('REVENUE', 100, 900).toString()).toBe('800');
    expect(normalBalanceSide('LIABILITY')).toBe('CREDIT');
    expect(normalBalanceSide('EQUITY')).toBe('CREDIT');
    expect(normalBalanceSide('REVENUE')).toBe('CREDIT');
  });

  it('reports a contra balance as negative rather than flipping its sign', () => {
    // Sales Returns is typed REVENUE but carries debits, so its natural balance
    // is negative - which is exactly what makes it reduce revenue in the P&L.
    expect(deriveAccountBalance('REVENUE', 566.4, 0).toString()).toBe('-566.4');
  });

  it('handles a decimal balance without floating point drift', () => {
    expect(deriveAccountBalance('ASSET', '0.1', '0.2').toString()).toBe('-0.1');
  });
});

describe('journal line validation', () => {
  const good = [
    { accountCode: '1300', debit: '100' },
    { accountCode: '2000', credit: '100' },
  ];

  it('accepts a balanced two-line entry and returns its totals', () => {
    const { lines, totalDebit, totalCredit } = normalizeJournalLines(good);
    expect(totalDebit.toString()).toBe('100');
    expect(totalCredit.toString()).toBe('100');
    expect(lines.map((line) => line.lineNumber)).toEqual([1, 2]);
  });

  it('rejects an entry with fewer than two lines', () => {
    expect(() => normalizeJournalLines([{ accountCode: '1300', debit: '100' }])).toThrowError(
      /at least two lines/i,
    );
    expect(() => normalizeJournalLines([])).toThrowError(/at least two lines/i);
  });

  it('rejects an unbalanced entry', () => {
    expect(() =>
      normalizeJournalLines([
        { accountCode: '1300', debit: '100' },
        { accountCode: '2000', credit: '99.99' },
      ]),
    ).toThrowError(/unbalanced/i);
  });

  it('rejects a line carrying both a debit and a credit', () => {
    expect(() =>
      normalizeJournalLines([
        { accountCode: '1300', debit: '100', credit: '100' },
        { accountCode: '2000', credit: '100' },
      ]),
    ).toThrowError(/not both/i);
  });

  it('rejects a negative amount on either side', () => {
    expect(() =>
      normalizeJournalLines([
        { accountCode: '1300', debit: '-100' },
        { accountCode: '2000', credit: '-100' },
      ]),
    ).toThrowError(/must not be negative/i);
  });

  it('rejects a zero-value line instead of silently dropping it', () => {
    expect(() =>
      normalizeJournalLines([
        { accountCode: '1300', debit: '100' },
        { accountCode: '2000', credit: '100' },
        { accountCode: '5100', debit: '0' },
      ]),
    ).toThrowError(/non-zero amount/i);
  });

  it('rounds to four decimal places once, at the line', () => {
    const { lines } = normalizeJournalLines([
      { accountCode: '1300', debit: '100.00005' },
      { accountCode: '2000', credit: '100.00005' },
    ]);
    expect(lines[0].debit.toString()).toBe('100.0001');
  });

  it('names the offending line so a bad entry can be found', () => {
    expect(() =>
      normalizeJournalLines([
        { accountCode: '1300', debit: '100' },
        { accountCode: '2000', credit: '100' },
        { accountCode: '5100', debit: '5', credit: '5' },
      ]),
    ).toThrowError(/line 3/i);
  });
});

describe('the system chart of accounts', () => {
  it('has a unique code per account', () => {
    const codes = SYSTEM_ACCOUNTS.map((account) => account.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('numbers accounts by type, so a code identifies what it is', () => {
    const prefixes = { ASSET: '1', LIABILITY: '2', EQUITY: '3', REVENUE: '4', EXPENSE: '5' };
    for (const account of SYSTEM_ACCOUNTS) {
      expect(account.code.startsWith(prefixes[account.type])).toBe(true);
    }
  });

  it('exposes every code the posting engine references', () => {
    const codes = new Set(SYSTEM_ACCOUNTS.map((account) => account.code));
    for (const code of Object.values(SYSTEM_ACCOUNT)) {
      expect(codes.has(code)).toBe(true);
    }
  });
});

describe('purchase accounting', () => {
  it('debits inventory and input tax, credits accounts payable', () => {
    // 10 @ 100 = 1000, 18% tax = 180, no discount.
    const lines = buildPurchaseLines({
      inventoryValue: '1000',
      taxTotal: '180',
      grandTotal: '1180',
      purchaseNumber: 'PUR-2026-000001',
    });

    expectBalanced(lines);
    expect(amountOn(lines, SYSTEM_ACCOUNT.INVENTORY, 'debit')).toBe('1000');
    expect(amountOn(lines, SYSTEM_ACCOUNT.INPUT_TAX_CREDIT, 'debit')).toBe('180');
    expect(amountOn(lines, SYSTEM_ACCOUNT.ACCOUNTS_PAYABLE, 'credit')).toBe('1180');
    // Nothing to explain away, so no variance line at all.
    expect(amountOn(lines, SYSTEM_ACCOUNT.INVENTORY_VALUATION_ADJUSTMENT, 'credit')).toBeNull();
  });

  it('posts a purchase discount as a price variance rather than hiding it', () => {
    // Stock is capitalised at the bill's line cost (1000), but only 900 is owed.
    const lines = buildPurchaseLines({
      inventoryValue: '1000',
      taxTotal: '0',
      grandTotal: '900',
      purchaseNumber: 'PUR-2026-000002',
    });

    expectBalanced(lines);
    expect(amountOn(lines, SYSTEM_ACCOUNT.INVENTORY, 'debit')).toBe('1000');
    expect(amountOn(lines, SYSTEM_ACCOUNT.ACCOUNTS_PAYABLE, 'credit')).toBe('900');
    expect(amountOn(lines, SYSTEM_ACCOUNT.INVENTORY_VALUATION_ADJUSTMENT, 'credit')).toBe('100');
  });

  it('puts the variance on the debit side when more is owed than capitalised', () => {
    const lines = buildPurchaseLines({
      inventoryValue: '900',
      taxTotal: '0',
      grandTotal: '1000',
      purchaseNumber: 'PUR-2026-000003',
    });

    expectBalanced(lines);
    expect(amountOn(lines, SYSTEM_ACCOUNT.INVENTORY_VALUATION_ADJUSTMENT, 'debit')).toBe('100');
  });

  it('omits the tax line entirely when a bill has no tax', () => {
    const lines = buildPurchaseLines({
      inventoryValue: '500',
      taxTotal: '0',
      grandTotal: '500',
      purchaseNumber: 'PUR-2026-000004',
    });

    expectBalanced(lines);
    expect(lines).toHaveLength(2);
    expect(amountOn(lines, SYSTEM_ACCOUNT.INPUT_TAX_CREDIT, 'debit')).toBeNull();
  });
});

describe('purchase return accounting', () => {
  it('debits accounts payable and credits inventory at the return valuation', () => {
    const lines = buildPurchaseReturnLines({
      inventoryValue: '400',
      grandTotal: '400',
      returnNumber: 'PR-2026-000001',
    });

    expectBalanced(lines);
    expect(amountOn(lines, SYSTEM_ACCOUNT.ACCOUNTS_PAYABLE, 'debit')).toBe('400');
    expect(amountOn(lines, SYSTEM_ACCOUNT.INVENTORY, 'credit')).toBe('400');
    expect(lines).toHaveLength(2);
  });

  it('absorbs a difference between the supplier credit and the stock removed', () => {
    // The documented Phase 5 residue: the two figures are allowed to differ, and
    // the difference has to land somewhere visible.
    const lines = buildPurchaseReturnLines({
      inventoryValue: '380',
      grandTotal: '400',
      returnNumber: 'PR-2026-000002',
    });

    expectBalanced(lines);
    expect(amountOn(lines, SYSTEM_ACCOUNT.INVENTORY_VALUATION_ADJUSTMENT, 'credit')).toBe('20');
  });
});

describe('supplier payment accounting', () => {
  it('debits accounts payable and credits bank for an allocated payment', () => {
    const lines = buildSupplierPaymentLines({
      allocatedAmount: '1180',
      unallocatedAmount: '0',
      amount: '1180',
      paymentMethod: 'BANK_TRANSFER',
      paymentNumber: 'PAY-2026-000001',
    });

    expectBalanced(lines);
    expect(amountOn(lines, SYSTEM_ACCOUNT.ACCOUNTS_PAYABLE, 'debit')).toBe('1180');
    expect(amountOn(lines, SYSTEM_ACCOUNT.BANK, 'credit')).toBe('1180');
  });

  it('books an unallocated payment as an advance, not as a settled bill', () => {
    const lines = buildSupplierPaymentLines({
      allocatedAmount: '0',
      unallocatedAmount: '5000',
      amount: '5000',
      paymentMethod: 'CASH',
      paymentNumber: 'PAY-2026-000002',
    });

    expectBalanced(lines);
    expect(amountOn(lines, SYSTEM_ACCOUNT.ADVANCE_TO_SUPPLIERS, 'debit')).toBe('5000');
    expect(amountOn(lines, SYSTEM_ACCOUNT.CASH, 'credit')).toBe('5000');
    expect(amountOn(lines, SYSTEM_ACCOUNT.ACCOUNTS_PAYABLE, 'debit')).toBeNull();
  });

  it('splits a part-allocated payment between the payable and the advance', () => {
    const lines = buildSupplierPaymentLines({
      allocatedAmount: '600',
      unallocatedAmount: '400',
      amount: '1000',
      paymentMethod: 'UPI',
      paymentNumber: 'PAY-2026-000003',
    });

    expectBalanced(lines);
    expect(amountOn(lines, SYSTEM_ACCOUNT.ACCOUNTS_PAYABLE, 'debit')).toBe('600');
    expect(amountOn(lines, SYSTEM_ACCOUNT.ADVANCE_TO_SUPPLIERS, 'debit')).toBe('400');
    expect(amountOn(lines, SYSTEM_ACCOUNT.BANK, 'credit')).toBe('1000');
  });

  it('sends only CASH to the cash account', () => {
    expect(cashOrBankAccount('CASH')).toBe(SYSTEM_ACCOUNT.CASH);
    for (const method of ['BANK_TRANSFER', 'BANK', 'UPI', 'CHEQUE', 'OTHER']) {
      expect(cashOrBankAccount(method)).toBe(SYSTEM_ACCOUNT.BANK);
    }
  });
});

describe('sales accounting', () => {
  it('records revenue, tax, receivable, COGS and inventory in one entry', () => {
    // 10 @ 120 with 18% tax = 1416, stock cost 80 each.
    const lines = buildSalesLines({
      grandTotal: '1416',
      taxTotal: '216',
      cogsValue: '800',
      invoiceNumber: 'INV-2026-000001',
    });

    expectBalanced(lines);
    expect(amountOn(lines, SYSTEM_ACCOUNT.ACCOUNTS_RECEIVABLE, 'debit')).toBe('1416');
    expect(amountOn(lines, SYSTEM_ACCOUNT.SALES_REVENUE, 'credit')).toBe('1200');
    expect(amountOn(lines, SYSTEM_ACCOUNT.TAX_PAYABLE, 'credit')).toBe('216');
    expect(amountOn(lines, SYSTEM_ACCOUNT.COST_OF_GOODS_SOLD, 'debit')).toBe('800');
    expect(amountOn(lines, SYSTEM_ACCOUNT.INVENTORY, 'credit')).toBe('800');
  });

  it('derives revenue from the invoice total so it can never drift from the receivable', () => {
    // A total that does not divide evenly still balances exactly.
    const lines = buildSalesLines({
      grandTotal: '1000.03',
      taxTotal: '152.55',
      cogsValue: '600.01',
      invoiceNumber: 'INV-2026-000002',
    });

    expectBalanced(lines);
    expect(amountOn(lines, SYSTEM_ACCOUNT.SALES_REVENUE, 'credit')).toBe('847.48');
  });

  it('omits the tax line when nothing was charged', () => {
    const lines = buildSalesLines({
      grandTotal: '1200',
      taxTotal: '0',
      cogsValue: '800',
      invoiceNumber: 'INV-2026-000003',
    });

    expectBalanced(lines);
    expect(amountOn(lines, SYSTEM_ACCOUNT.TAX_PAYABLE, 'credit')).toBeNull();
    expect(lines).toHaveLength(4);
  });
});

describe('sales return accounting', () => {
  it('debits sales returns and tax, credits the receivable, and puts stock back', () => {
    // 4 of 10 returned: 566.40 credit, 86.40 of it tax, 320 of frozen cost back.
    const lines = buildSalesReturnLines({
      grandTotal: '566.40',
      taxTotal: '86.40',
      cogsValue: '320',
      returnNumber: 'SR-2026-000001',
    });

    expectBalanced(lines);
    expect(amountOn(lines, SYSTEM_ACCOUNT.SALES_RETURNS, 'debit')).toBe('480');
    expect(amountOn(lines, SYSTEM_ACCOUNT.TAX_PAYABLE, 'debit')).toBe('86.4');
    expect(amountOn(lines, SYSTEM_ACCOUNT.ACCOUNTS_RECEIVABLE, 'credit')).toBe('566.4');
    expect(amountOn(lines, SYSTEM_ACCOUNT.INVENTORY, 'debit')).toBe('320');
    expect(amountOn(lines, SYSTEM_ACCOUNT.COST_OF_GOODS_SOLD, 'credit')).toBe('320');
  });

  it('is the exact mirror of the sale it reverses', () => {
    const sale = buildSalesLines({
      grandTotal: '1416',
      taxTotal: '216',
      cogsValue: '800',
      invoiceNumber: 'INV-2026-000001',
    });
    const fullReturn = buildSalesReturnLines({
      grandTotal: '1416',
      taxTotal: '216',
      cogsValue: '800',
      returnNumber: 'SR-2026-000002',
    });

    // Every amount the sale put on one side, the return puts on the other.
    expect(amountOn(fullReturn, SYSTEM_ACCOUNT.ACCOUNTS_RECEIVABLE, 'credit')).toBe(
      amountOn(sale, SYSTEM_ACCOUNT.ACCOUNTS_RECEIVABLE, 'debit'),
    );
    expect(amountOn(fullReturn, SYSTEM_ACCOUNT.SALES_RETURNS, 'debit')).toBe(
      amountOn(sale, SYSTEM_ACCOUNT.SALES_REVENUE, 'credit'),
    );
    expect(amountOn(fullReturn, SYSTEM_ACCOUNT.COST_OF_GOODS_SOLD, 'credit')).toBe(
      amountOn(sale, SYSTEM_ACCOUNT.COST_OF_GOODS_SOLD, 'debit'),
    );
    expect(amountOn(fullReturn, SYSTEM_ACCOUNT.INVENTORY, 'debit')).toBe(
      amountOn(sale, SYSTEM_ACCOUNT.INVENTORY, 'credit'),
    );
  });
});

describe('customer payment accounting', () => {
  it('debits bank and credits the receivable for an allocated receipt', () => {
    const lines = buildCustomerPaymentLines({
      allocatedAmount: '1416',
      unallocatedAmount: '0',
      amount: '1416',
      paymentMethod: 'BANK',
      paymentNumber: 'RCP-2026-000001',
    });

    expectBalanced(lines);
    expect(amountOn(lines, SYSTEM_ACCOUNT.BANK, 'debit')).toBe('1416');
    expect(amountOn(lines, SYSTEM_ACCOUNT.ACCOUNTS_RECEIVABLE, 'credit')).toBe('1416');
  });

  it('books an unallocated receipt as a liability to the customer', () => {
    const lines = buildCustomerPaymentLines({
      allocatedAmount: '0',
      unallocatedAmount: '2000',
      amount: '2000',
      paymentMethod: 'CASH',
      paymentNumber: 'RCP-2026-000002',
    });

    expectBalanced(lines);
    expect(amountOn(lines, SYSTEM_ACCOUNT.CASH, 'debit')).toBe('2000');
    expect(amountOn(lines, SYSTEM_ACCOUNT.CUSTOMER_ADVANCES, 'credit')).toBe('2000');
  });

  it('splits a part-allocated receipt between the invoice and customer credit', () => {
    const lines = buildCustomerPaymentLines({
      allocatedAmount: '1000',
      unallocatedAmount: '500',
      amount: '1500',
      paymentMethod: 'CHEQUE',
      paymentNumber: 'RCP-2026-000003',
    });

    expectBalanced(lines);
    expect(amountOn(lines, SYSTEM_ACCOUNT.ACCOUNTS_RECEIVABLE, 'credit')).toBe('1000');
    expect(amountOn(lines, SYSTEM_ACCOUNT.CUSTOMER_ADVANCES, 'credit')).toBe('500');
  });
});

describe('valuing a journal from the stock movements it caused', () => {
  it('sums the movement totalCost with Decimal, never floating point', () => {
    expect(sumMovementCost([{ totalCost: '0.1' }, { totalCost: '0.2' }]).toString()).toBe('0.3');
  });

  it('is zero for a document that moved no stock', () => {
    expect(sumMovementCost([]).toString()).toBe('0');
  });
});
