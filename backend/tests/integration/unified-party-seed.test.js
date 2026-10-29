import { describe, it, expect, beforeAll } from 'vitest';
import { resetDatabase } from '../helpers/db.js';
import { seedDemoUnified } from '../../prisma/seed-demo-unified.js';
import { getPartyStatement } from '../../src/modules/parties/party-statement.service.js';
import * as partyService from '../../src/modules/parties/party.service.js';

// Proves the unified-party demo seed itself: every party is created with no
// type (so it is usable for both buying and selling), and the posting services
// produce exactly the independent receivable/payable each party should have.
// This is the seed's own regression test - if the seed maths or the posting
// flow drift, this fails.

let result;
let user;

beforeAll(async () => {
  await resetDatabase();
  result = await seedDemoUnified();
  user = { companyId: result.demo.company.id };
}, 120000);

describe('the unified-party demo seed', () => {
  it('created six parties, each usable for both buying and selling', async () => {
    expect(result.created).toBe(true);
    const ids = Object.values(result.parties);
    expect(ids).toHaveLength(6);
    for (const id of ids) {
      const party = await partyService.getById(user, id);
      expect(party.relationship).toBe('BOTH');
      expect(party.isCustomer).toBe(true);
      expect(party.isSupplier).toBe(true);
    }
  });

  it('produces the exact independent receivable and payable for each party', async () => {
    const actual = {};
    for (const id of Object.values(result.parties)) {
      const statement = await getPartyStatement(user, id);
      actual[statement.party.name] = {
        receivable: statement.summary.closingReceivable,
        payable: statement.summary.closingPayable,
      };
    }
    // The two sides are reported separately and never netted.
    expect(actual).toEqual(result.expected);
  });

  it('gives the mixed party enough transactions for a multi-page statement', async () => {
    const statement = await getPartyStatement(user, result.parties.F);
    expect(statement.summary.entryCount).toBeGreaterThanOrEqual(14);
    // It trades both ways with real returns and payments of different methods.
    const kinds = new Set(statement.lines.map((l) => l.kind));
    for (const kind of ['SALE', 'PURCHASE', 'RECEIPT', 'PAYMENT', 'SALES_RETURN', 'PURCHASE_RETURN']) {
      expect(kinds.has(kind)).toBe(true);
    }
  });
});
