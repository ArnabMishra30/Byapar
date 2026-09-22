import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma, resetDatabase, createCompanyWithUsers, login } from '../helpers/db.js';
import { SYSTEM_ACCOUNTS } from '../../src/modules/accounting/system-accounts.js';

const auth = (token) => ({ Authorization: `Bearer ${token}` });

let companyA;
let companyB;
let adminA;
let staffA;
let adminB;

const listAccounts = (token, query = '') =>
  request(app).get(`/api/v1/accounts${query}`).set(auth(token));
const createAccount = (token, body) =>
  request(app).post('/api/v1/accounts').set(auth(token)).send(body);
const patchAccount = (token, id, body) =>
  request(app).patch(`/api/v1/accounts/${id}`).set(auth(token)).send(body);

async function accountByCode(token, code) {
  const response = await listAccounts(token, `?search=${code}&limit=100`);
  return response.body.data.find((account) => account.code === code);
}

/** A fresh, unused account code so tests never collide with each other. */
let codeCounter = 0;
const nextCode = () => `900${(codeCounter += 1)}`;

beforeAll(async () => {
  await resetDatabase();

  companyA = await createCompanyWithUsers('alpha');
  companyB = await createCompanyWithUsers('beta');

  adminA = await login(app, companyA.admin.email, companyA.adminPassword);
  staffA = await login(app, companyA.staff.email, companyA.staffPassword);
  adminB = await login(app, companyB.admin.email, companyB.adminPassword);
});

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------

describe('system chart of accounts', () => {
  it('gives every company the full system chart automatically', async () => {
    const response = await listAccounts(adminA, '?isSystem=true&limit=100');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(SYSTEM_ACCOUNTS.length);

    const codes = response.body.data.map((account) => account.code).sort();
    expect(codes).toEqual(SYSTEM_ACCOUNTS.map((account) => account.code).sort());
  });

  it('creates the same accounts for a second company, as separate rows', async () => {
    const a = await accountByCode(adminA, '1300');
    const b = await accountByCode(adminB, '1300');

    expect(a.code).toBe('1300');
    expect(b.code).toBe('1300');
    // Same code, different row: codes are unique per company, never globally.
    expect(a.id).not.toBe(b.id);
  });

  it('reports the normal balance side of every account', async () => {
    const response = await listAccounts(adminA, '?limit=100');
    const byCode = Object.fromEntries(
      response.body.data.map((account) => [account.code, account]),
    );

    expect(byCode['1300'].normalBalance).toBe('DEBIT');
    expect(byCode['5000'].normalBalance).toBe('DEBIT');
    expect(byCode['2000'].normalBalance).toBe('CREDIT');
    expect(byCode['3000'].normalBalance).toBe('CREDIT');
    expect(byCode['4000'].normalBalance).toBe('CREDIT');
  });

  it('filters by account type', async () => {
    const response = await listAccounts(adminA, '?type=LIABILITY&limit=100');

    expect(response.status).toBe(200);
    expect(response.body.data.length).toBeGreaterThan(0);
    expect(response.body.data.every((account) => account.type === 'LIABILITY')).toBe(true);
  });
});

describe('creating accounts', () => {
  it('creates a normal account, never a system one', async () => {
    const code = nextCode();
    const response = await createAccount(adminA, {
      code,
      name: 'Rent',
      type: 'EXPENSE',
      // A client claiming isSystem must not be believed.
      isSystem: true,
    });

    expect(response.status).toBe(201);
    expect(response.body.data.account.code).toBe(code);
    expect(response.body.data.account.isSystem).toBe(false);
    expect(response.body.data.account.isActive).toBe(true);
  });

  it('rejects a duplicate code within the company', async () => {
    const code = nextCode();
    await createAccount(adminA, { code, name: 'First', type: 'EXPENSE' });

    const response = await createAccount(adminA, { code, name: 'Second', type: 'EXPENSE' });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('ACCOUNT_CODE_TAKEN');
  });

  it('rejects a code that collides with a system account', async () => {
    const response = await createAccount(adminA, { code: '1300', name: 'My Stock', type: 'ASSET' });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('ACCOUNT_CODE_TAKEN');
  });

  it('allows the same code in a different company', async () => {
    const code = nextCode();
    const first = await createAccount(adminA, { code, name: 'Shared Code', type: 'EXPENSE' });
    const second = await createAccount(adminB, { code, name: 'Shared Code', type: 'EXPENSE' });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
  });

  it('allows a duplicate NAME, which is not an identity', async () => {
    const first = await createAccount(adminA, {
      code: nextCode(),
      name: 'Utilities',
      type: 'EXPENSE',
    });
    const second = await createAccount(adminA, {
      code: nextCode(),
      name: 'Utilities',
      type: 'EXPENSE',
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
  });

  it('validates the type, the code shape and the name', async () => {
    const badType = await createAccount(adminA, {
      code: nextCode(),
      name: 'Nope',
      type: 'PROFIT',
    });
    const badCode = await createAccount(adminA, { code: 'a b c', name: 'Nope', type: 'EXPENSE' });
    const badName = await createAccount(adminA, { code: nextCode(), name: 'X', type: 'EXPENSE' });

    expect(badType.status).toBe(400);
    expect(badCode.status).toBe(400);
    expect(badName.status).toBe(400);
  });
});

describe('account hierarchy', () => {
  it('attaches a child to a parent in the same company', async () => {
    const parent = await createAccount(adminA, {
      code: nextCode(),
      name: 'Operating Expenses',
      type: 'EXPENSE',
    });
    const child = await createAccount(adminA, {
      code: nextCode(),
      name: 'Electricity',
      type: 'EXPENSE',
      parentId: parent.body.data.account.id,
    });

    expect(child.status).toBe(201);
    expect(child.body.data.account.parent.id).toBe(parent.body.data.account.id);
    expect(child.body.data.account.parent.name).toBe('Operating Expenses');
  });

  it("refuses a parent from another company, reporting it as not found", async () => {
    const foreign = await createAccount(adminB, {
      code: nextCode(),
      name: 'Beta Parent',
      type: 'EXPENSE',
    });

    const response = await createAccount(adminA, {
      code: nextCode(),
      name: 'Cross tenant child',
      type: 'EXPENSE',
      parentId: foreign.body.data.account.id,
    });

    // 404, not 403: company A must not learn that this id exists at all.
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('ACCOUNT_PARENT_NOT_FOUND');
  });

  it('refuses to make an account its own parent', async () => {
    const account = await createAccount(adminA, {
      code: nextCode(),
      name: 'Self parent',
      type: 'EXPENSE',
    });

    const response = await patchAccount(adminA, account.body.data.account.id, {
      parentId: account.body.data.account.id,
    });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('ACCOUNT_CIRCULAR_PARENT');
  });

  it('refuses a cycle through a chain of ancestors', async () => {
    const a = await createAccount(adminA, { code: nextCode(), name: 'Level A', type: 'EXPENSE' });
    const b = await createAccount(adminA, {
      code: nextCode(),
      name: 'Level B',
      type: 'EXPENSE',
      parentId: a.body.data.account.id,
    });
    const c = await createAccount(adminA, {
      code: nextCode(),
      name: 'Level C',
      type: 'EXPENSE',
      parentId: b.body.data.account.id,
    });

    // A -> B -> C already exists. Making C the parent of A closes the loop.
    const response = await patchAccount(adminA, a.body.data.account.id, {
      parentId: c.body.data.account.id,
    });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('ACCOUNT_CIRCULAR_PARENT');

    // The hierarchy is unchanged by the rejected attempt.
    const unchanged = await request(app)
      .get(`/api/v1/accounts/${a.body.data.account.id}`)
      .set(auth(adminA));
    expect(unchanged.body.data.account.parentId).toBeNull();
  });

  it('detaches a child by setting the parent to null', async () => {
    const parent = await createAccount(adminA, {
      code: nextCode(),
      name: 'Detachable parent',
      type: 'EXPENSE',
    });
    const child = await createAccount(adminA, {
      code: nextCode(),
      name: 'Detachable child',
      type: 'EXPENSE',
      parentId: parent.body.data.account.id,
    });

    const response = await patchAccount(adminA, child.body.data.account.id, { parentId: null });

    expect(response.status).toBe(200);
    expect(response.body.data.account.parent).toBeNull();
  });
});

describe('updating and deleting accounts', () => {
  it('renames an account but never changes its code or type', async () => {
    const created = await createAccount(adminA, {
      code: nextCode(),
      name: 'Old name',
      type: 'EXPENSE',
    });
    const { id, code } = created.body.data.account;

    const response = await patchAccount(adminA, id, {
      name: 'New name',
      // Both are silently ignored: neither may ever change.
      code: '9999',
      type: 'ASSET',
    });

    expect(response.status).toBe(200);
    expect(response.body.data.account.name).toBe('New name');
    expect(response.body.data.account.code).toBe(code);
    expect(response.body.data.account.type).toBe('EXPENSE');
  });

  it('deactivates a normal account', async () => {
    const created = await createAccount(adminA, {
      code: nextCode(),
      name: 'Retiring',
      type: 'EXPENSE',
    });

    const response = await patchAccount(adminA, created.body.data.account.id, { isActive: false });

    expect(response.status).toBe(200);
    expect(response.body.data.account.isActive).toBe(false);
  });

  it('refuses to deactivate a system account', async () => {
    const inventory = await accountByCode(adminA, '1300');

    const response = await patchAccount(adminA, inventory.id, { isActive: false });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('ACCOUNT_SYSTEM_PROTECTED');

    const stillActive = await accountByCode(adminA, '1300');
    expect(stillActive.isActive).toBe(true);
  });

  it('refuses to delete a system account', async () => {
    const payable = await accountByCode(adminA, '2000');

    const response = await request(app)
      .delete(`/api/v1/accounts/${payable.id}`)
      .set(auth(adminA));

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('ACCOUNT_SYSTEM_PROTECTED');
    expect(await accountByCode(adminA, '2000')).toBeTruthy();
  });

  it('deletes an unused normal account', async () => {
    const created = await createAccount(adminA, {
      code: nextCode(),
      name: 'Never used',
      type: 'EXPENSE',
    });

    const response = await request(app)
      .delete(`/api/v1/accounts/${created.body.data.account.id}`)
      .set(auth(adminA));

    expect(response.status).toBe(200);
    expect(await accountByCode(adminA, created.body.data.account.code)).toBeUndefined();
  });

  it('refuses to delete an account that has children', async () => {
    const parent = await createAccount(adminA, {
      code: nextCode(),
      name: 'Has children',
      type: 'EXPENSE',
    });
    await createAccount(adminA, {
      code: nextCode(),
      name: 'A child',
      type: 'EXPENSE',
      parentId: parent.body.data.account.id,
    });

    const response = await request(app)
      .delete(`/api/v1/accounts/${parent.body.data.account.id}`)
      .set(auth(adminA));

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('ACCOUNT_HAS_CHILDREN');
  });
});

describe('accounting RBAC', () => {
  it('lets STAFF read accounts, journals, the ledger and the statements', async () => {
    for (const path of [
      '/api/v1/accounts',
      '/api/v1/journal-entries',
      '/api/v1/general-ledger',
      '/api/v1/general-ledger/summary',
      '/api/v1/accounting/trial-balance',
      '/api/v1/accounting/profit-loss',
      '/api/v1/accounting/balance-sheet',
    ]) {
      const response = await request(app).get(path).set(auth(staffA));
      expect(`${path}:${response.status}`).toBe(`${path}:200`);
    }
  });

  it('refuses to let STAFF create, edit or delete an account', async () => {
    const existing = await accountByCode(adminA, '1000');

    const created = await createAccount(staffA, {
      code: nextCode(),
      name: 'Staff attempt',
      type: 'EXPENSE',
    });
    const updated = await patchAccount(staffA, existing.id, { name: 'Renamed by staff' });
    const deleted = await request(app)
      .delete(`/api/v1/accounts/${existing.id}`)
      .set(auth(staffA));

    expect(created.status).toBe(403);
    expect(updated.status).toBe(403);
    expect(deleted.status).toBe(403);
  });

  it('requires authentication everywhere in the module', async () => {
    for (const path of [
      '/api/v1/accounts',
      '/api/v1/journal-entries',
      '/api/v1/general-ledger',
      '/api/v1/accounting/trial-balance',
    ]) {
      const response = await request(app).get(path);
      expect(response.status).toBe(401);
    }
  });

  it('exposes no endpoint that creates or edits a journal entry', async () => {
    // Journals exist only because a document was posted. There is deliberately
    // no way to write one by hand, for any role.
    const created = await request(app)
      .post('/api/v1/journal-entries')
      .set(auth(adminA))
      .send({ entryDate: '2026-09-01', lines: [] });

    const patched = await request(app)
      .patch('/api/v1/journal-entries/00000000-0000-0000-0000-000000000000')
      .set(auth(adminA))
      .send({ description: 'edited' });

    const deleted = await request(app)
      .delete('/api/v1/journal-entries/00000000-0000-0000-0000-000000000000')
      .set(auth(adminA));

    expect(created.status).toBe(404);
    expect(patched.status).toBe(404);
    expect(deleted.status).toBe(404);
  });
});

describe('accounting tenant isolation', () => {
  it("returns 404 for another company's account", async () => {
    const foreign = await accountByCode(adminB, '1300');

    const read = await request(app).get(`/api/v1/accounts/${foreign.id}`).set(auth(adminA));
    const ledger = await request(app)
      .get(`/api/v1/accounts/${foreign.id}/ledger`)
      .set(auth(adminA));
    const updated = await patchAccount(adminA, foreign.id, { name: 'Hijacked' });

    expect(read.status).toBe(404);
    expect(ledger.status).toBe(404);
    expect(updated.status).toBe(404);

    // And the account is untouched.
    const stillThere = await request(app)
      .get(`/api/v1/accounts/${foreign.id}`)
      .set(auth(adminB));
    expect(stillThere.body.data.account.name).toBe('Inventory');
  });

  it('never lists another company accounts', async () => {
    const response = await listAccounts(adminA, '?limit=100');
    const ids = response.body.data.map((account) => account.id);

    const foreign = await accountByCode(adminB, '2000');
    expect(ids).not.toContain(foreign.id);
  });

  it('ignores a companyId sent in the body', async () => {
    const code = nextCode();
    const response = await createAccount(adminA, {
      code,
      name: 'Injected company',
      type: 'EXPENSE',
      companyId: companyB.company.id,
    });

    expect(response.status).toBe(201);

    const stored = await prisma.account.findFirst({ where: { code, companyId: companyA.company.id } });
    expect(stored).toBeTruthy();
    expect(stored.companyId).toBe(companyA.company.id);
  });
});

describe('database-level double-entry constraints', () => {
  let accountId;
  let entryId;

  beforeEach(async () => {
    const inventory = await accountByCode(adminA, '1300');
    accountId = inventory.id;

    await prisma.journalLine.deleteMany({ where: { companyId: companyA.company.id } });
    await prisma.journalEntry.deleteMany({ where: { companyId: companyA.company.id } });

    const entry = await prisma.journalEntry.create({
      data: {
        companyId: companyA.company.id,
        journalNumber: `JV-TEST-${Date.now()}`,
        entryDate: new Date('2026-09-01T00:00:00.000Z'),
        sourceType: 'PURCHASE',
        sourceId: '11111111-1111-1111-1111-111111111111',
        status: 'POSTED',
        createdById: companyA.admin.id,
      },
    });
    entryId = entry.id;
  });

  const rawLine = (debit, credit) =>
    prisma.journalLine.create({
      data: {
        journalEntryId: entryId,
        companyId: companyA.company.id,
        accountId,
        lineNumber: 1,
        debit,
        credit,
        entryDate: new Date('2026-09-01T00:00:00.000Z'),
      },
    });

  it('rejects a line with both a debit and a credit, in the database itself', async () => {
    // Bypassing the service entirely: this is the constraint, not the guard.
    await expect(rawLine('10', '10')).rejects.toThrow();
  });

  it('rejects a line with neither a debit nor a credit', async () => {
    await expect(rawLine('0', '0')).rejects.toThrow();
  });

  it('rejects a negative amount', async () => {
    await expect(rawLine('-10', '0')).rejects.toThrow();
  });

  it('accepts a well-formed single-sided line', async () => {
    const line = await rawLine('10', '0');
    expect(line.debit.toString()).toBe('10');
  });

  it('refuses a second journal entry for the same source document', async () => {
    // The unique constraint is what makes double-posting incapable of
    // double-counting the ledger, whatever the application code does.
    await expect(
      prisma.journalEntry.create({
        data: {
          companyId: companyA.company.id,
          journalNumber: `JV-TEST-DUP-${Date.now()}`,
          entryDate: new Date('2026-09-01T00:00:00.000Z'),
          sourceType: 'PURCHASE',
          sourceId: '11111111-1111-1111-1111-111111111111',
          status: 'POSTED',
          createdById: companyA.admin.id,
        },
      }),
    ).rejects.toThrow();
  });

  it('allows the same source id in a different company', async () => {
    const entry = await prisma.journalEntry.create({
      data: {
        companyId: companyB.company.id,
        journalNumber: `JV-TEST-B-${Date.now()}`,
        entryDate: new Date('2026-09-01T00:00:00.000Z'),
        sourceType: 'PURCHASE',
        sourceId: '11111111-1111-1111-1111-111111111111',
        status: 'POSTED',
        createdById: companyB.admin.id,
      },
    });

    expect(entry.id).toBeTruthy();
    await prisma.journalEntry.delete({ where: { id: entry.id } });
  });
});
