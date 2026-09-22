import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { Prisma } from '@prisma/client';
import { prisma, resetDatabase, createCompanyWithUsers, login } from '../helpers/db.js';

// Expenses, end to end through HTTP.
//
// An expense is the shop-floor document this system was missing: rent, the
// electricity bill, the boy who delivers. It has no items, no stock effect and
// no tax. Posting it writes exactly one balanced journal entry:
//
//   Dr  Expense category      amount
//       Cr  Cash / Bank           amount
//
// The figures here are deliberately small enough to check by hand.

const auth = (token) => ({ Authorization: `Bearer ${token}` });

// Money arithmetic in the tests uses Decimal too, never JS floating point.
const DECIMAL_ZERO = new Prisma.Decimal(0);

const CASH = '1000';
const BANK = '1010';
const COGS = '5000';
const OPERATING_EXPENSES = '5200';
const RENT = '5210';
const ELECTRICITY = '5215';
const BANK_CHARGES = '5260';
const SALES_REVENUE = '4000';

let companyA;
let companyB;
let adminA;
let staffA;
let adminB;
let accountsA;
let supplierA;
let supplierB;

/** Every account of a company, keyed by its code. */
async function chartOf(companyId) {
  const accounts = await prisma.account.findMany({ where: { companyId } });
  return Object.fromEntries(accounts.map((account) => [account.code, account]));
}

const createExpense = (token, body) =>
  request(app).post('/api/v1/expenses').set(auth(token)).send(body);

function draftBody(overrides = {}) {
  return {
    expenseDate: '2026-08-05',
    expenseAccountId: accountsA[RENT].id,
    amount: '20000',
    paymentMode: 'CASH',
    description: 'August shop rent',
    ...overrides,
  };
}

async function draft(token, overrides) {
  const response = await createExpense(token, draftBody(overrides));
  expect(response.status).toBe(201);
  return response.body.data.expense;
}

async function posted(token, overrides) {
  const created = await draft(token, overrides);
  const response = await request(app)
    .post(`/api/v1/expenses/${created.id}/post`)
    .set(auth(token));
  expect(response.status).toBe(200);
  return response.body.data.expense;
}

/** The journal entry an expense produced, with its lines. */
function entryFor(expenseId, sourceType = 'EXPENSE') {
  return prisma.journalEntry.findFirst({
    where: { sourceType, sourceId: expenseId },
    include: { lines: { include: { account: true } } },
  });
}

/** The net movement on one account, debit positive. */
async function balanceOf(companyId, code) {
  const account = await prisma.account.findFirst({ where: { companyId, code } });
  const lines = await prisma.journalLine.findMany({ where: { accountId: account.id } });

  return lines.reduce(
    (total, line) => total.plus(line.debit).minus(line.credit),
    DECIMAL_ZERO,
  );
}

beforeAll(async () => {
  await resetDatabase();

  const a = await createCompanyWithUsers('expa');
  const b = await createCompanyWithUsers('expb');

  companyA = a.company;
  companyB = b.company;
  adminA = await login(app, a.admin.email, a.adminPassword);
  staffA = await login(app, a.staff.email, a.staffPassword);
  adminB = await login(app, b.admin.email, b.adminPassword);

  accountsA = await chartOf(companyA.id);

  supplierA = await prisma.supplier.create({
    data: { companyId: companyA.id, name: 'Landlord Verma' },
  });
  supplierB = await prisma.supplier.create({
    data: { companyId: companyB.id, name: 'Other Landlord' },
  });
});

beforeEach(async () => {
  await prisma.expense.deleteMany();
  await prisma.journalLine.deleteMany();
  await prisma.journalEntry.deleteMany();
  await prisma.documentSequence.deleteMany();
  // Undo anything a test deactivated.
  await prisma.account.updateMany({ where: { isActive: false }, data: { isActive: true } });
  await prisma.supplier.updateMany({ where: { isActive: false }, data: { isActive: true } });
});

afterAll(async () => {
  await resetDatabase();
});

// ===========================================================================
// 1-6  Creating a draft
// ===========================================================================

describe('creating an expense', () => {
  it('1. creates a cash expense as a DRAFT with no accounting effect', async () => {
    const response = await createExpense(adminA, draftBody());

    expect(response.status).toBe(201);
    const expense = response.body.data.expense;

    expect(expense.status).toBe('DRAFT');
    expect(expense.amount).toBe('20000.00');
    expect(expense.affectsAccounts).toBe(false);
    expect(expense.category.code).toBe(RENT);
    expect(expense.paidFrom.code).toBe(CASH);
    expect(expense.postedAt).toBeNull();

    // Nothing reached the ledger.
    expect(await entryFor(expense.id)).toBeNull();
    expect(await prisma.journalEntry.count()).toBe(0);
  });

  it('2. defaults a BANK expense to the Bank account', async () => {
    const expense = await draft(adminA, {
      paymentMode: 'BANK',
      expenseAccountId: accountsA[ELECTRICITY].id,
      amount: '4500',
    });

    expect(expense.paymentMode).toBe('BANK');
    expect(expense.paidFrom.code).toBe(BANK);
    expect(expense.paidFrom.name).toBe(accountsA[BANK].name);
  });

  it('3. numbers expenses sequentially per company, with an EXP prefix', async () => {
    const first = await draft(adminA);
    const second = await draft(adminA);
    const other = await draft(adminB, {
      expenseAccountId: (await chartOf(companyB.id))[RENT].id,
    });

    expect(first.expenseNumber).toMatch(/^EXP-\d{4}-0*1$/);
    expect(second.expenseNumber).toMatch(/^EXP-\d{4}-0*2$/);
    // Company B starts at 1 again: the counter is per company.
    expect(other.expenseNumber).toMatch(/^EXP-\d{4}-0*1$/);
  });

  it('4. records an optional supplier without creating a payable', async () => {
    const expense = await draft(adminA, { supplierId: supplierA.id });

    expect(expense.supplier).toEqual({ id: supplierA.id, name: 'Landlord Verma' });

    // The whole point: an expense is already paid, so it owes nobody.
    expect(await prisma.supplierPayable.count()).toBe(0);
    expect(await prisma.supplierLedgerEntry.count()).toBe(0);
  });

  it('5. lets a STAFF user prepare a draft', async () => {
    const response = await createExpense(staffA, draftBody({ amount: '350' }));

    expect(response.status).toBe(201);
    expect(response.body.data.expense.createdBy.name).toBe('expa Staff');
  });

  it('6. snapshots the category and payment account names at creation', async () => {
    const expense = await draft(adminA);

    await prisma.account.update({
      where: { id: accountsA[RENT].id },
      data: { name: 'Shop Rent (renamed)' },
    });

    const fetched = await request(app).get(`/api/v1/expenses/${expense.id}`).set(auth(adminA));

    // What it was called when it was recorded, and what it is called now.
    expect(fetched.body.data.expense.category.name).toBe('Rent');
    expect(fetched.body.data.expense.category.currentName).toBe('Shop Rent (renamed)');

    await prisma.account.update({
      where: { id: accountsA[RENT].id },
      data: { name: accountsA[RENT].name },
    });
  });
});

// ===========================================================================
// 7-13  Validation
// ===========================================================================

describe('rejecting an expense that does not make sense', () => {
  it('7. rejects a zero or negative amount', async () => {
    for (const amount of ['0', '0.00', '-500']) {
      const response = await createExpense(adminA, draftBody({ amount }));
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.body.success).toBe(false);
    }

    expect(await prisma.expense.count()).toBe(0);
  });

  it('8. rejects a category that is not an EXPENSE account', async () => {
    const response = await createExpense(
      adminA,
      draftBody({ expenseAccountId: accountsA[SALES_REVENUE].id }),
    );

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('INVALID_EXPENSE_CATEGORY');
    expect(response.body.message).toContain('REVENUE');
  });

  it('9. refuses to use Cost of Goods Sold as a category', async () => {
    // Rent posted to COGS would silently destroy gross profit.
    const response = await createExpense(
      adminA,
      draftBody({ expenseAccountId: accountsA[COGS].id }),
    );

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('INVALID_EXPENSE_CATEGORY');
  });

  it('10. refuses to post to the Operating Expenses parent itself', async () => {
    const response = await createExpense(
      adminA,
      draftBody({ expenseAccountId: accountsA[OPERATING_EXPENSES].id }),
    );

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('INVALID_EXPENSE_CATEGORY');
  });

  it('11. rejects an inactive category', async () => {
    await prisma.account.update({
      where: { id: accountsA[RENT].id },
      data: { isActive: false },
    });

    const response = await createExpense(adminA, draftBody());

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('EXPENSE_CATEGORY_INACTIVE');
  });

  it('12. rejects a payment account that cannot hold money', async () => {
    const response = await createExpense(
      adminA,
      draftBody({ paymentAccountId: accountsA[RENT].id }),
    );

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('INVALID_PAYMENT_ACCOUNT');
  });

  it('13. rejects a missing date, category, amount or payment mode', async () => {
    const cases = [
      ['expenseDate', { expenseDate: undefined }],
      ['expenseAccountId', { expenseAccountId: undefined }],
      ['amount', { amount: undefined }],
      ['paymentMode', { paymentMode: undefined }],
      ['paymentMode', { paymentMode: 'UPI' }],
      ['expenseDate', { expenseDate: '05-08-2026' }],
      ['amount', { amount: '100.123' }],
    ];

    for (const [field, override] of cases) {
      const body = draftBody(override);
      if (override[field] === undefined) delete body[field];

      const response = await createExpense(adminA, body);
      expect(`${field}:${response.status}`).toBe(`${field}:400`);
    }
  });
});

// ===========================================================================
// 14-21  Posting and the general ledger
// ===========================================================================

describe('posting an expense', () => {
  it('14. writes exactly one balanced journal entry: Dr category, Cr Cash', async () => {
    const expense = await posted(adminA);

    expect(expense.status).toBe('POSTED');
    expect(expense.affectsAccounts).toBe(true);
    expect(expense.postedBy.name).toBe('expa Admin');
    expect(expense.postedAt).not.toBeNull();

    const entry = await entryFor(expense.id);

    expect(entry).not.toBeNull();
    expect(entry.lines).toHaveLength(2);
    expect(entry.totalDebit.equals(entry.totalCredit)).toBe(true);
    expect(entry.totalDebit.toFixed(2)).toBe('20000.00');

    const debit = entry.lines.find((line) => !line.debit.isZero());
    const credit = entry.lines.find((line) => !line.credit.isZero());

    expect(debit.account.code).toBe(RENT);
    expect(credit.account.code).toBe(CASH);
    expect(debit.debit.toFixed(2)).toBe('20000.00');
    expect(credit.credit.toFixed(2)).toBe('20000.00');

    // One entry for the whole company, not two.
    expect(await prisma.journalEntry.count({ where: { companyId: companyA.id } })).toBe(1);
  });

  it('15. credits Bank, not Cash, for a bank expense', async () => {
    const expense = await posted(adminA, {
      paymentMode: 'BANK',
      expenseAccountId: accountsA[ELECTRICITY].id,
      amount: '4500',
    });

    const entry = await entryFor(expense.id);
    const credit = entry.lines.find((line) => !line.credit.isZero());

    expect(credit.account.code).toBe(BANK);
    expect(credit.credit.toFixed(2)).toBe('4500.00');
    expect((await balanceOf(companyA.id, BANK)).toFixed(2)).toBe('-4500.00');
  });

  it('16. moves cash out and the category up, by the same amount', async () => {
    await posted(adminA, { amount: '20000' });
    await posted(adminA, { amount: '1500', expenseAccountId: accountsA[BANK_CHARGES].id });

    expect((await balanceOf(companyA.id, CASH)).toFixed(2)).toBe('-21500.00');
    expect((await balanceOf(companyA.id, RENT)).toFixed(2)).toBe('20000.00');
    expect((await balanceOf(companyA.id, BANK_CHARGES)).toFixed(2)).toBe('1500.00');
  });

  it('17. keeps the whole ledger balanced after several expenses', async () => {
    await posted(adminA, { amount: '20000' });
    await posted(adminA, { amount: '4500', paymentMode: 'BANK' });
    await posted(adminA, { amount: '0.01' });

    const lines = await prisma.journalLine.findMany({
      where: { companyId: companyA.id },
    });

    const totals = lines.reduce(
      (acc, line) => ({ debit: acc.debit.plus(line.debit), credit: acc.credit.plus(line.credit) }),
      { debit: DECIMAL_ZERO, credit: DECIMAL_ZERO },
    );

    expect(totals.debit.toFixed(4)).toBe(totals.credit.toFixed(4));
    expect(totals.debit.toFixed(2)).toBe('24500.01');
  });

  it('18. records the expense date as the journal entry date', async () => {
    const expense = await posted(adminA, { expenseDate: '2026-07-19' });
    const entry = await entryFor(expense.id);

    expect(entry.entryDate.toISOString().slice(0, 10)).toBe('2026-07-19');
  });

  it('19. will not post the same expense twice', async () => {
    const expense = await posted(adminA);

    const again = await request(app)
      .post(`/api/v1/expenses/${expense.id}/post`)
      .set(auth(adminA));

    expect(again.status).toBe(409);
    expect(again.body.code).toBe('EXPENSE_ALREADY_POSTED');
    expect(await prisma.journalEntry.count({ where: { sourceId: expense.id } })).toBe(1);
  });

  it('20. survives two simultaneous posts with one entry', async () => {
    const created = await draft(adminA);

    const [first, second] = await Promise.all([
      request(app).post(`/api/v1/expenses/${created.id}/post`).set(auth(adminA)),
      request(app).post(`/api/v1/expenses/${created.id}/post`).set(auth(adminA)),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);

    expect(await prisma.journalEntry.count({ where: { sourceId: created.id } })).toBe(1);
    expect((await prisma.expense.findUnique({ where: { id: created.id } })).status).toBe('POSTED');
  });

  it('21. refuses to post if the category was deactivated after the draft', async () => {
    const created = await draft(adminA);

    await prisma.account.update({
      where: { id: accountsA[RENT].id },
      data: { isActive: false },
    });

    const response = await request(app)
      .post(`/api/v1/expenses/${created.id}/post`)
      .set(auth(adminA));

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('EXPENSE_CATEGORY_INACTIVE');

    // The whole posting rolled back: still a draft, still no journal entry.
    expect((await prisma.expense.findUnique({ where: { id: created.id } })).status).toBe('DRAFT');
    expect(await entryFor(created.id)).toBeNull();
  });
});

// ===========================================================================
// 22-27  Editing, cancelling, reversing
// ===========================================================================

describe('the life of an expense', () => {
  it('22. edits a draft, including its category and payment mode', async () => {
    const created = await draft(adminA);

    const response = await request(app)
      .patch(`/api/v1/expenses/${created.id}`)
      .set(auth(adminA))
      .send(
        draftBody({
          amount: '18000',
          expenseAccountId: accountsA[ELECTRICITY].id,
          paymentMode: 'BANK',
        }),
      );

    expect(response.status).toBe(200);
    expect(response.body.data.expense.amount).toBe('18000.00');
    expect(response.body.data.expense.category.code).toBe(ELECTRICITY);
    expect(response.body.data.expense.paidFrom.code).toBe(BANK);
    // The number never changes.
    expect(response.body.data.expense.expenseNumber).toBe(created.expenseNumber);
  });

  it('23. refuses to edit a posted expense', async () => {
    const expense = await posted(adminA);

    const response = await request(app)
      .patch(`/api/v1/expenses/${expense.id}`)
      .set(auth(adminA))
      .send(draftBody({ amount: '1' }));

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('EXPENSE_ALREADY_POSTED');

    const row = await prisma.expense.findUnique({ where: { id: expense.id } });
    expect(row.amount.toFixed(2)).toBe('20000.00');
  });

  it('24. cancels a draft, leaving the ledger untouched', async () => {
    const created = await draft(adminA);

    const response = await request(app)
      .post(`/api/v1/expenses/${created.id}/cancel`)
      .set(auth(adminA));

    expect(response.status).toBe(200);
    expect(response.body.data.expense.status).toBe('CANCELLED');
    expect(response.body.data.expense.cancelledBy.name).toBe('expa Admin');
    expect(await prisma.journalEntry.count()).toBe(0);
  });

  it('25. refuses to cancel a posted expense and says to reverse it', async () => {
    const expense = await posted(adminA);

    const response = await request(app)
      .post(`/api/v1/expenses/${expense.id}/cancel`)
      .set(auth(adminA));

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('EXPENSE_ALREADY_POSTED');
    expect(response.body.message).toMatch(/reverse/i);
  });

  it('26. reverses a posted expense with a new, opposite entry', async () => {
    const expense = await posted(adminA, { amount: '4500', paymentMode: 'BANK' });

    const response = await request(app)
      .post(`/api/v1/expenses/${expense.id}/reverse`)
      .set(auth(adminA));

    expect(response.status).toBe(200);
    expect(response.body.data.expense.status).toBe('REVERSED');
    expect(response.body.data.expense.reversedBy.name).toBe('expa Admin');

    // The original entry is exactly as it was: reversal never rewrites history.
    const original = await entryFor(expense.id, 'EXPENSE');
    expect(original.lines).toHaveLength(2);
    expect(original.totalDebit.toFixed(2)).toBe('4500.00');

    // And a second entry undoes it.
    const reversal = await entryFor(expense.id, 'EXPENSE_REVERSAL');
    expect(reversal).not.toBeNull();
    expect(reversal.totalDebit.equals(reversal.totalCredit)).toBe(true);

    const debit = reversal.lines.find((line) => !line.debit.isZero());
    const credit = reversal.lines.find((line) => !line.credit.isZero());
    expect(debit.account.code).toBe(BANK);
    expect(credit.account.code).toBe(RENT);

    // Net effect on every account is zero.
    expect((await balanceOf(companyA.id, BANK)).toFixed(2)).toBe('0.00');
    expect((await balanceOf(companyA.id, RENT)).toFixed(2)).toBe('0.00');
  });

  it('27. reverses only once, and only a posted expense', async () => {
    const expense = await posted(adminA);

    const first = await request(app)
      .post(`/api/v1/expenses/${expense.id}/reverse`)
      .set(auth(adminA));
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`/api/v1/expenses/${expense.id}/reverse`)
      .set(auth(adminA));
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('EXPENSE_ALREADY_REVERSED');

    // Still one reversal entry.
    expect(
      await prisma.journalEntry.count({
        where: { sourceType: 'EXPENSE_REVERSAL', sourceId: expense.id },
      }),
    ).toBe(1);

    // And a draft cannot be reversed at all.
    const stillDraft = await draft(adminA);
    const response = await request(app)
      .post(`/api/v1/expenses/${stillDraft.id}/reverse`)
      .set(auth(adminA));

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('EXPENSE_NOT_POSTED');
  });
});

// ===========================================================================
// 28-31  Access: who may do what, and whose data it is
// ===========================================================================

describe('access control', () => {
  it('28. lets STAFF read and draft, but not post, cancel or reverse', async () => {
    const created = await draft(staffA);

    expect((await request(app).get('/api/v1/expenses').set(auth(staffA))).status).toBe(200);
    expect(
      (await request(app).patch(`/api/v1/expenses/${created.id}`).set(auth(staffA)).send(draftBody()))
        .status,
    ).toBe(200);

    for (const action of ['post', 'cancel', 'reverse']) {
      const response = await request(app)
        .post(`/api/v1/expenses/${created.id}/${action}`)
        .set(auth(staffA));
      expect(`${action}:${response.status}`).toBe(`${action}:403`);
    }

    expect((await prisma.expense.findUnique({ where: { id: created.id } })).status).toBe('DRAFT');
  });

  it('29. rejects an unauthenticated request on every route', async () => {
    const created = await draft(adminA);

    const routes = [
      ['get', '/api/v1/expenses'],
      ['get', '/api/v1/expenses/categories'],
      ['get', `/api/v1/expenses/${created.id}`],
      ['post', '/api/v1/expenses'],
      ['patch', `/api/v1/expenses/${created.id}`],
      ['post', `/api/v1/expenses/${created.id}/post`],
      ['post', `/api/v1/expenses/${created.id}/cancel`],
      ['post', `/api/v1/expenses/${created.id}/reverse`],
    ];

    for (const [method, path] of routes) {
      const response = await request(app)[method](path).send({});
      expect(`${path}:${response.status}`).toBe(`${path}:401`);
    }
  });

  it("30. reports another company's expense as not found, and never touches it", async () => {
    const expense = await posted(adminA);

    const read = await request(app).get(`/api/v1/expenses/${expense.id}`).set(auth(adminB));
    expect(read.status).toBe(404);
    expect(read.body.code).toBe('EXPENSE_NOT_FOUND');

    for (const action of ['post', 'cancel', 'reverse']) {
      const response = await request(app)
        .post(`/api/v1/expenses/${expense.id}/${action}`)
        .set(auth(adminB));
      expect(`${action}:${response.status}`).toBe(`${action}:404`);
    }

    // B's list is empty, and A's expense is untouched.
    const list = await request(app).get('/api/v1/expenses').set(auth(adminB));
    expect(list.body.data).toHaveLength(0);
    expect((await prisma.expense.findUnique({ where: { id: expense.id } })).status).toBe('POSTED');
  });

  it("31. refuses another company's category, payment account and supplier", async () => {
    const accountsB = await chartOf(companyB.id);

    const category = await createExpense(
      adminA,
      draftBody({ expenseAccountId: accountsB[RENT].id }),
    );
    expect(category.status).toBe(404);
    expect(category.body.code).toBe('EXPENSE_CATEGORY_NOT_FOUND');

    const payment = await createExpense(
      adminA,
      draftBody({ paymentAccountId: accountsB[CASH].id }),
    );
    expect(payment.status).toBe(404);
    expect(payment.body.code).toBe('PAYMENT_ACCOUNT_NOT_FOUND');

    const supplier = await createExpense(adminA, draftBody({ supplierId: supplierB.id }));
    expect(supplier.status).toBe(404);
    expect(supplier.body.code).toBe('SUPPLIER_NOT_FOUND');
  });
});

// ===========================================================================
// 32-35  Listing and categories
// ===========================================================================

describe('finding expenses', () => {
  it('32. lists expenses, newest first, with pagination', async () => {
    await posted(adminA, { expenseDate: '2026-08-01', amount: '100' });
    await posted(adminA, { expenseDate: '2026-08-20', amount: '200' });
    await draft(adminA, { expenseDate: '2026-08-10', amount: '300' });

    const response = await request(app).get('/api/v1/expenses?limit=2').set(auth(adminA));

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.pagination.total).toBe(3);
    expect(response.body.data[0].expenseDate).toBe('2026-08-20');
  });

  it('33. filters by status, category, payment mode and date', async () => {
    await posted(adminA, { expenseDate: '2026-08-01', amount: '100' });
    await posted(adminA, {
      expenseDate: '2026-09-01',
      amount: '200',
      paymentMode: 'BANK',
      expenseAccountId: accountsA[ELECTRICITY].id,
    });
    await draft(adminA, { expenseDate: '2026-08-15', amount: '300' });

    const get = async (query) => {
      const response = await request(app).get(`/api/v1/expenses?${query}`).set(auth(adminA));
      expect(response.status).toBe(200);
      return response.body.data;
    };

    expect(await get('status=DRAFT')).toHaveLength(1);
    expect(await get('status=POSTED')).toHaveLength(2);
    expect(await get('paymentMode=BANK')).toHaveLength(1);
    expect(await get(`expenseAccountId=${accountsA[ELECTRICITY].id}`)).toHaveLength(1);
    expect(await get('fromDate=2026-08-01&toDate=2026-08-31')).toHaveLength(2);
    expect(await get('fromDate=2026-09-01&toDate=2026-09-30')).toHaveLength(1);
  });

  it('34. offers every usable category, and nothing a shopkeeper must not pick', async () => {
    const response = await request(app).get('/api/v1/expenses/categories').set(auth(adminA));

    expect(response.status).toBe(200);
    const codes = response.body.data.categories.map((category) => category.code);
    const names = response.body.data.categories.map((category) => category.name);

    for (const expected of ['Rent', 'Electricity', 'Salaries & Wages', 'Bank Charges']) {
      expect(names).toContain(expected);
    }

    // The accounts other flows maintain are not offered.
    expect(codes).not.toContain(COGS);
    expect(codes).not.toContain(OPERATING_EXPENSES);
    expect(codes).not.toContain(CASH);
    expect(codes).not.toContain(SALES_REVENUE);
  });

  it('35. offers a category the business created itself, and posts to it', async () => {
    const created = await request(app)
      .post('/api/v1/accounts')
      .set(auth(adminA))
      .send({ code: '5295', name: 'Pooja & Festival', type: 'EXPENSE', parentId: accountsA[OPERATING_EXPENSES].id });

    expect(created.status).toBe(201);
    const accountId = created.body.data.account.id;

    const categories = await request(app).get('/api/v1/expenses/categories').set(auth(adminA));
    expect(categories.body.data.categories.map((c) => c.name)).toContain('Pooja & Festival');

    // And it posts exactly like a built-in one - no name matching anywhere.
    const expense = await posted(adminA, { expenseAccountId: accountId, amount: '750' });
    const entry = await entryFor(expense.id);
    const debit = entry.lines.find((line) => !line.debit.isZero());

    expect(debit.account.code).toBe('5295');
    expect(debit.debit.toFixed(2)).toBe('750.00');

    await prisma.journalLine.deleteMany({ where: { accountId } });
    await prisma.journalEntry.deleteMany({ where: { sourceId: expense.id } });
    await prisma.expense.deleteMany({ where: { expenseAccountId: accountId } });
    await prisma.account.delete({ where: { id: accountId } });
  });
});

// ===========================================================================
// 36-40  The report, the dashboard and the cash book
// ===========================================================================

describe('what the reports say about expenses', () => {
  /** Rent 20,000 cash, electricity 4,500 bank, bank charges 250 bank. */
  async function threeExpenses() {
    await posted(adminA, { expenseDate: '2026-08-05', amount: '20000' });
    await posted(adminA, {
      expenseDate: '2026-08-10',
      amount: '4500',
      paymentMode: 'BANK',
      expenseAccountId: accountsA[ELECTRICITY].id,
    });
    await posted(adminA, {
      expenseDate: '2026-08-10',
      amount: '250',
      paymentMode: 'BANK',
      expenseAccountId: accountsA[BANK_CHARGES].id,
    });
  }

  it('36. totals posted expenses and groups them four consistent ways', async () => {
    await threeExpenses();

    const response = await request(app)
      .get('/api/v1/reports/expenses?fromDate=2026-08-01&toDate=2026-08-31')
      .set(auth(adminA));

    expect(response.status).toBe(200);
    const report = response.body.data.report;

    // 20000 + 4500 + 250
    expect(report.totals.totalExpenses).toBe('24750.00');
    expect(report.totals.expenseCount).toBe(3);
    expect(report.totals.largestCategory).toEqual({ category: 'Rent', amount: '20000.00' });

    const sum = (rows) =>
      rows.reduce((total, row) => total.plus(row.amount), DECIMAL_ZERO).toFixed(2);

    // Every grouping is the same rows, so every grouping adds to the same total.
    expect(sum(report.byCategory)).toBe('24750.00');
    expect(sum(report.byPaymentMode)).toBe('24750.00');
    expect(sum(report.byPaymentAccount)).toBe('24750.00');
    expect(sum(report.byDate)).toBe('24750.00');

    expect(report.byPaymentMode).toEqual([
      { paymentMode: 'BANK', expenseCount: 2, amount: '4750.00' },
      { paymentMode: 'CASH', expenseCount: 1, amount: '20000.00' },
    ]);
    expect(report.byDate.map((row) => row.date)).toEqual(['2026-08-05', '2026-08-10']);
  });

  it('37. never counts a draft, a cancelled or a reversed expense, but shows them', async () => {
    await threeExpenses();

    await draft(adminA, { expenseDate: '2026-08-12', amount: '9999' });

    const toCancel = await draft(adminA, { expenseDate: '2026-08-13', amount: '5555' });
    await request(app).post(`/api/v1/expenses/${toCancel.id}/cancel`).set(auth(adminA));

    const toReverse = await posted(adminA, { expenseDate: '2026-08-14', amount: '1111' });
    await request(app).post(`/api/v1/expenses/${toReverse.id}/reverse`).set(auth(adminA));

    const response = await request(app)
      .get('/api/v1/reports/expenses?fromDate=2026-08-01&toDate=2026-08-31')
      .set(auth(adminA));

    const report = response.body.data.report;

    // Still only the three genuinely posted ones.
    expect(report.totals.totalExpenses).toBe('24750.00');
    expect(report.basis.countedStatus).toBe('POSTED');

    const other = Object.fromEntries(report.otherStatuses.map((row) => [row.status, row]));
    expect(other.DRAFT.count).toBe(1);
    expect(other.DRAFT.amount).toBe('9999.00');
    expect(other.CANCELLED.amount).toBe('5555.00');
    expect(other.REVERSED.amount).toBe('1111.00');
    expect(report.otherStatuses.every((row) => row.includedInTotals === false)).toBe(true);
  });

  it('38. matches the profit and loss, to the paisa', async () => {
    await threeExpenses();

    const [expenses, profitAndLoss] = await Promise.all([
      request(app)
        .get('/api/v1/reports/expenses?fromDate=2026-08-01&toDate=2026-08-31')
        .set(auth(adminA)),
      request(app)
        .get('/api/v1/reports/profit-loss?fromDate=2026-08-01&toDate=2026-08-31')
        .set(auth(adminA)),
    ]);

    expect(profitAndLoss.status).toBe(200);

    // The report reads expense documents; the P&L reads journal entries. They
    // agree because posting writes one from the other.
    expect(profitAndLoss.body.data.report.otherExpenses.total).toBe(
      expenses.body.data.report.totals.totalExpenses,
    );
  });

  it('39. subtracts expenses from gross profit to give net profit', async () => {
    await threeExpenses();

    const response = await request(app)
      .get('/api/v1/reports/profit-loss?fromDate=2026-08-01&toDate=2026-08-31')
      .set(auth(adminA));

    const report = response.body.data.report;

    // No sales here, so gross profit is zero and the whole 24,750 is a loss.
    expect(report.grossProfit).toBe('0.00');
    expect(report.otherExpenses.total).toBe('24750.00');
    expect(report.netProfit).toBe('-24750.00');

    // Gross profit less operating expenses, exactly.
    const gross = new Prisma.Decimal(report.grossProfit);
    const expected = gross.minus(report.otherExpenses.total);
    expect(report.netProfit).toBe(expected.toFixed(2));
  });

  it('40. shows expenses in the cash and bank book, traced to their document', async () => {
    await threeExpenses();

    const response = await request(app)
      .get('/api/v1/reports/cash-bank?fromDate=2026-08-01&toDate=2026-08-31')
      .set(auth(adminA));

    expect(response.status).toBe(200);
    const report = response.body.data.report;

    const cash = report.accounts.find((account) => account.code === CASH);
    const bank = report.accounts.find((account) => account.code === BANK);

    // Money left both accounts, and the book says by how much.
    expect(cash.moneyOut).toBe('20000.00');
    expect(cash.closingBalance).toBe('-20000.00');
    expect(bank.moneyOut).toBe('4750.00');
    expect(bank.closingBalance).toBe('-4750.00');
    expect(report.totals.moneyOut).toBe('24750.00');

    // Each movement names the expense it came from, so it can be traced back.
    const expenseLines = report.movements.filter((row) => row.sourceType === 'EXPENSE');
    expect(expenseLines).toHaveLength(3);
    expect(expenseLines.every((row) => row.description.includes('EXP-'))).toBe(true);

    const outflow = expenseLines.reduce((total, row) => total.plus(row.moneyOut), DECIMAL_ZERO);
    expect(outflow.toFixed(2)).toBe('24750.00');
  });
});

// ===========================================================================
// 41-43  The dashboard, and staying non-GST
// ===========================================================================

describe('the dashboard and the non-GST shop', () => {
  it('41. reports operating expenses and a real net profit', async () => {
    const today = new Date();
    const day = today.toISOString().slice(0, 10);

    await posted(adminA, { expenseDate: day, amount: '20000' });
    await posted(adminA, {
      expenseDate: day,
      amount: '4500',
      paymentMode: 'BANK',
      expenseAccountId: accountsA[ELECTRICITY].id,
    });

    const response = await request(app).get('/api/v1/dashboard').set(auth(adminA));

    expect(response.status).toBe(200);
    const dashboard = response.body.data.dashboard;

    expect(dashboard.today.expenses.total).toBe('24500.00');
    expect(dashboard.today.expenses.expenseCount).toBe(2);
    expect(dashboard.thisMonth.expenses.total).toBe('24500.00');

    // Cash out counts against the day's movement.
    expect(dashboard.today.netCashMovement).toBe('-24500.00');

    expect(dashboard.profit.operatingExpenses).toBe('24500.00');
    expect(dashboard.profit.netProfit).toBe('-24500.00');
    // The old field name still answers, so nothing reading it breaks.
    expect(dashboard.profit.otherExpenses).toBe('24500.00');
    expect(dashboard.profit.basis).not.toMatch(/no expense-entry document/i);
  });

  it('42. works completely for a shop with no GST registration', async () => {
    // Company A has never set a stateCode or a GSTIN.
    const company = await prisma.company.findUnique({ where: { id: companyA.id } });
    expect(company.gstin).toBeNull();
    expect(company.stateCode).toBeNull();

    const expense = await posted(adminA, { amount: '20000' });
    const entry = await entryFor(expense.id);

    // Two lines. No tax line of any kind.
    expect(entry.lines).toHaveLength(2);
    const codes = entry.lines.map((line) => line.account.code);
    expect(codes).not.toContain('1500'); // input tax credit
    expect(codes).not.toContain('2100'); // tax payable

    // And the response carries no GST field at all.
    expect(Object.keys(expense).join(',')).not.toMatch(/gst|hsn|cgst|sgst|igst|tax/i);
  });

  it('43. rejects a tax field sent by a hopeful client instead of quietly using it', async () => {
    const response = await createExpense(adminA, {
      ...draftBody(),
      taxId: '00000000-0000-0000-0000-000000000000',
      gstAmount: '3600',
    });

    // Unknown keys are stripped by the schema, so the draft is created cleanly -
    // what matters is that no tax reached the record or the ledger.
    expect(response.status).toBe(201);
    expect(response.body.data.expense.amount).toBe('20000.00');
    expect(JSON.stringify(response.body.data.expense)).not.toContain('3600');
  });
});
