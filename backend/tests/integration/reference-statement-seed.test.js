import { describe, it, expect, beforeAll } from 'vitest';
import { resetDatabase } from '../helpers/db.js';
import { seedDemoReference } from '../../prisma/seed-demo-reference.js';
import { getPartyStatement } from '../../src/modules/parties/party-statement.service.js';

// Proves the reference seed reproduces PartyReport.pdf: the "Abdulla" party ends
// with a ₹1,03,065 receivable and nothing payable, from 13 unpaid sales and two
// unallocated ("Unused") cash advances, under an "Amazing Enterprises" header
// with GST-free amounts.

let result;
let user;

beforeAll(async () => {
  await resetDatabase();
  result = await seedDemoReference();
  user = { companyId: result.companyId };
}, 120000);

describe('the reference (PartyReport) seed', () => {
  it('reproduces Abdulla exactly: 13 sales, 2 unused advances, 1,03,065 receivable', async () => {
    const statement = await getPartyStatement(user, result.abdullaId);
    expect(statement.summary.closingReceivable).toBe('103065.00');
    expect(statement.summary.closingPayable).toBe('0.00');

    const sales = statement.lines.filter((l) => l.kind === 'SALE');
    const receipts = statement.lines.filter((l) => l.kind === 'RECEIPT');
    expect(sales).toHaveLength(13);
    expect(receipts).toHaveLength(2);

    for (const receipt of receipts) {
      expect(receipt.payment.modeLabel).toBe('Cash');
      expect(receipt.paymentStatus).toBe('UNUSED');
    }

    // The reference's first bill: ₹17,400 over four lines.
    const first = sales.find((l) => l.date === '2025-03-29');
    expect(first.total).toBe('17400.00');
    expect(first.document.items).toHaveLength(4);
    expect(first.document.items.map((i) => i.amount)).toEqual(['10000.00', '1800.00', '5400.00', '200.00']);
  });

  it('shows the Amazing Enterprises header and GST-free amounts', async () => {
    const statement = await getPartyStatement(user, result.abdullaId);
    expect(statement.company.name).toBe('Amazing Enterprises');
    expect(statement.company.gstin).toBe('29BFQPR7201J1ZV');
    const sale = statement.lines.find((l) => l.total === '27200.00');
    expect(sale.document.tax).toBe('0.00');
  });
});
