import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma, resetDatabase, createCompanyWithUsers, login } from '../helpers/db.js';

// MONEY ACCOUNTS: several cash / bank / wallet accounts of the shop's own.
//   - each is a real account in the ledger, so balances come from the ledger;
//   - expenses pay from one account, or split across several;
//   - money received and paid choose an account too;
//   - transfers move money between them, and can be undone;
//   - opening balances; old Cash/Bank behaviour unchanged; tenants isolated.

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const PASSWORD = 'test-password-123';

let owner;
let staff;
let otherOwner;
let ctx = {};

const balances = async (token = owner) => {
  const res = await request(app).get('/api/v1/money-accounts').set(auth(token));
  return Object.fromEntries(res.body.data.accounts.map((a) => [a.name, a.balance]));
};

beforeAll(async () => {
  await resetDatabase();
  const company = await createCompanyWithUsers('money');
  const other = await createCompanyWithUsers('moneyb');
  owner = await login(app, company.admin.email, PASSWORD);
  staff = await login(app, company.staff.email, PASSWORD);
  otherOwner = await login(app, other.admin.email, PASSWORD);

  const categories = await request(app).get('/api/v1/expenses/categories').set(auth(owner));
  ctx.rentCategory = categories.body.data.categories[0].accountId;
});

describe('setting up accounts', () => {
  it('starts with the main Cash and Bank, and adds more with opening balances', async () => {
    const start = await request(app).get('/api/v1/money-accounts').set(auth(owner));
    expect(start.body.data.accounts.map((a) => a.kind).sort()).toEqual(['BANK', 'CASH']);

    const sbi = await request(app)
      .post('/api/v1/money-accounts')
      .set(auth(owner))
      .send({ name: 'SBI Current', kind: 'BANK', openingBalance: '50000', openingDate: '2026-10-01' });
    const phonepe = await request(app)
      .post('/api/v1/money-accounts')
      .set(auth(owner))
      .send({ name: 'PhonePe UPI', kind: 'BANK' });
    const drawer = await request(app)
      .post('/api/v1/money-accounts')
      .set(auth(owner))
      .send({ name: 'Cash drawer', kind: 'CASH', openingBalance: '5000' });

    expect(sbi.status).toBe(201);
    expect(sbi.body.data.account).toMatchObject({ kind: 'BANK', balance: '50000.00' });
    expect(drawer.body.data.account.kind).toBe('CASH');
    ctx.sbi = sbi.body.data.account.id;
    ctx.phonepe = phonepe.body.data.account.id;
    ctx.drawer = drawer.body.data.account.id;

    // The opening balance is a real, balanced journal entry against capital.
    const entry = await prisma.journalEntry.findFirst({ where: { sourceType: 'MONEY_ACCOUNT_OPENING', sourceId: ctx.sbi } });
    expect(entry).not.toBeNull();
  });

  it('refuses a duplicate name, and staff cannot add accounts', async () => {
    const dup = await request(app).post('/api/v1/money-accounts').set(auth(owner)).send({ name: 'sbi current', kind: 'BANK' });
    expect(dup.status).toBe(409);
    const asStaff = await request(app).post('/api/v1/money-accounts').set(auth(staff)).send({ name: 'X', kind: 'CASH' });
    expect(asStaff.status).toBe(403);
  });

  it('the new accounts appear in the Cash & Bank report', async () => {
    const res = await request(app).get('/api/v1/reports/cash-bank').set(auth(owner));
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain('SBI Current');
  });
});

describe('reference details', () => {
  it('stores bank, account number, IFSC and UPI ID; staff see the number masked', async () => {
    const res = await request(app).patch(`/api/v1/money-accounts/${ctx.sbi}`).set(auth(owner)).send({
      bankName: 'State Bank of India',
      accountNumber: '32154789652145',
      ifsc: 'sbin0001234',
      holderName: 'Money Company',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.account).toMatchObject({ ifsc: 'SBIN0001234', accountNumber: '32154789652145' });

    await request(app).patch(`/api/v1/money-accounts/${ctx.phonepe}`).set(auth(owner)).send({ upiId: 'moneyshop@ybl' });

    const asStaff = await request(app).get('/api/v1/money-accounts').set(auth(staff));
    const sbi = asStaff.body.data.accounts.find((a) => a.id === ctx.sbi);
    expect(sbi.accountNumber).toBe('••••2145');
    expect(asStaff.body.data.accounts.find((a) => a.id === ctx.phonepe).upiId).toBe('moneyshop@ybl');
  });

  it('refuses a malformed IFSC, UPI ID or account number', async () => {
    const results = await Promise.all([
      request(app).patch(`/api/v1/money-accounts/${ctx.sbi}`).set(auth(owner)).send({ ifsc: 'SBI123' }),
      request(app).patch(`/api/v1/money-accounts/${ctx.sbi}`).set(auth(owner)).send({ upiId: 'not a upi' }),
      request(app).patch(`/api/v1/money-accounts/${ctx.sbi}`).set(auth(owner)).send({ accountNumber: '12AB' }),
    ]);
    expect(results.map((r) => r.status)).toEqual([400, 400, 400]);
  });

  it('can be given when the account is added', async () => {
    const res = await request(app)
      .post('/api/v1/money-accounts')
      .set(auth(owner))
      .send({ name: 'GPay', kind: 'BANK', upiId: 'shop.owner@okaxis' });
    expect(res.status).toBe(201);
    expect(res.body.data.account.upiId).toBe('shop.owner@okaxis');
  });
});

describe('expenses', () => {
  it('pays from the chosen account', async () => {
    const created = await request(app).post('/api/v1/expenses').set(auth(owner)).send({
      expenseDate: '2026-10-05',
      expenseAccountId: ctx.rentCategory,
      amount: '2000',
      paymentMode: 'BANK',
      paymentAccountId: ctx.sbi,
    });
    expect(created.status).toBe(201);
    const posted = await request(app).post(`/api/v1/expenses/${created.body.data.expense.id}/post`).set(auth(owner));
    expect(posted.status).toBe(200);
    expect((await balances())['SBI Current']).toBe('48000.00');
  });

  it('splits one expense across accounts: 1,000 cash drawer + 500 PhonePe', async () => {
    await request(app)
      .post('/api/v1/money-accounts/transfers')
      .set(auth(owner))
      .send({ fromAccountId: ctx.sbi, toAccountId: ctx.phonepe, amount: '1000', date: '2026-10-05' });

    const created = await request(app).post('/api/v1/expenses').set(auth(owner)).send({
      expenseDate: '2026-10-06',
      expenseAccountId: ctx.rentCategory,
      amount: '1500',
      paymentMode: 'CASH',
      paymentParts: [
        { accountId: ctx.drawer, amount: '1000' },
        { accountId: ctx.phonepe, amount: '500' },
      ],
    });
    expect(created.status).toBe(201);
    expect(created.body.data.expense.paymentParts).toHaveLength(2);
    expect(created.body.data.expense.paidFrom.name).toBe('Cash drawer + PhonePe UPI');
    ctx.splitExpense = created.body.data.expense.id;

    await request(app).post(`/api/v1/expenses/${ctx.splitExpense}/post`).set(auth(owner));
    const b = await balances();
    expect(b['Cash drawer']).toBe('4000.00');
    expect(b['PhonePe UPI']).toBe('500.00');
  });

  it('refuses a split that does not add up', async () => {
    const res = await request(app).post('/api/v1/expenses').set(auth(owner)).send({
      expenseDate: '2026-10-06',
      expenseAccountId: ctx.rentCategory,
      amount: '1500',
      paymentMode: 'CASH',
      paymentParts: [
        { accountId: ctx.drawer, amount: '1000' },
        { accountId: ctx.phonepe, amount: '400' },
      ],
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('SPLIT_DOES_NOT_ADD_UP');
  });

  it('reversing a split expense puts the money back in each account', async () => {
    const res = await request(app).post(`/api/v1/expenses/${ctx.splitExpense}/reverse`).set(auth(owner));
    expect(res.status).toBe(200);
    const b = await balances();
    expect(b['Cash drawer']).toBe('5000.00');
    expect(b['PhonePe UPI']).toBe('1000.00');
  });
});

describe('money received and paid', () => {
  beforeAll(async () => {
    ctx.customer = (await request(app).post('/api/v1/customers').set(auth(owner)).send({ name: 'UPI Customer' })).body.data.customer.id;
    ctx.supplier = (await request(app).post('/api/v1/suppliers').set(auth(owner)).send({ name: 'Bank Supplier' })).body.data.supplier.id;
  });

  it('a receipt by UPI lands in PhonePe, not the main Bank', async () => {
    const created = await request(app).post('/api/v1/customer-payments').set(auth(owner)).send({
      customerId: ctx.customer,
      paymentDate: '2026-10-06',
      amount: '700',
      paymentMethod: 'UPI',
      moneyAccountId: ctx.phonepe,
      allocations: [],
    });
    expect(created.status).toBe(201);
    expect(created.body.data.payment.moneyAccount.name).toBe('PhonePe UPI');
    await request(app).post(`/api/v1/customer-payments/${created.body.data.payment.id}/post`).set(auth(owner));
    const b = await balances();
    expect(b['PhonePe UPI']).toBe('1700.00');
    expect(b.Bank).toBe('0.00');
  });

  it('a supplier payment comes out of SBI', async () => {
    const created = await request(app).post('/api/v1/supplier-payments').set(auth(owner)).send({
      supplierId: ctx.supplier,
      paymentDate: '2026-10-06',
      amount: '3000',
      paymentMethod: 'BANK_TRANSFER',
      moneyAccountId: ctx.sbi,
      allocations: [],
    });
    await request(app).post(`/api/v1/supplier-payments/${created.body.data.payment.id}/post`).set(auth(owner));
    expect((await balances())['SBI Current']).toBe('44000.00');
  });

  it('without an account chosen, cash still goes to the main Cash as before', async () => {
    const created = await request(app).post('/api/v1/customer-payments').set(auth(owner)).send({
      customerId: ctx.customer,
      paymentDate: '2026-10-06',
      amount: '100',
      paymentMethod: 'CASH',
      allocations: [],
    });
    await request(app).post(`/api/v1/customer-payments/${created.body.data.payment.id}/post`).set(auth(owner));
    expect((await balances()).Cash).toBe('100.00');
  });
});

describe('transfers', () => {
  it('moves money between accounts, and can be undone', async () => {
    const before = await balances();
    const res = await request(app)
      .post('/api/v1/money-accounts/transfers')
      .set(auth(owner))
      .send({ fromAccountId: ctx.drawer, toAccountId: ctx.sbi, amount: '2000', date: '2026-10-07', notes: 'Deposit' });
    expect(res.status).toBe(201);
    expect(res.body.data.transfer).toMatchObject({ amount: '2000.00', from: { name: 'Cash drawer' }, to: { name: 'SBI Current' } });

    let b = await balances();
    expect(Number(b['Cash drawer'])).toBe(Number(before['Cash drawer']) - 2000);
    expect(Number(b['SBI Current'])).toBe(Number(before['SBI Current']) + 2000);

    const undo = await request(app).post(`/api/v1/money-accounts/transfers/${res.body.data.transfer.id}/reverse`).set(auth(owner));
    expect(undo.status).toBe(200);
    b = await balances();
    expect(b['Cash drawer']).toBe(before['Cash drawer']);

    const list = await request(app).get('/api/v1/money-accounts/transfers').set(auth(owner));
    expect(list.body.data.transfers.find((t) => t.id === res.body.data.transfer.id).isReversed).toBe(true);
  });

  it('refuses the same account twice, and a plain staff account cannot move money', async () => {
    const same = await request(app)
      .post('/api/v1/money-accounts/transfers')
      .set(auth(owner))
      .send({ fromAccountId: ctx.sbi, toAccountId: ctx.sbi, amount: '1', date: '2026-10-07' });
    expect(same.status).toBe(400);
    const asStaff = await request(app)
      .post('/api/v1/money-accounts/transfers')
      .set(auth(staff))
      .send({ fromAccountId: ctx.sbi, toAccountId: ctx.drawer, amount: '1', date: '2026-10-07' });
    expect(asStaff.status).toBe(403);
  });
});

describe('tenant isolation', () => {
  it('another shop never sees these accounts nor can pay from them', async () => {
    const list = await request(app).get('/api/v1/money-accounts').set(auth(otherOwner));
    expect(list.body.data.accounts.map((a) => a.name)).not.toContain('SBI Current');

    const customer = await request(app).post('/api/v1/customers').set(auth(otherOwner)).send({ name: 'Theirs' });
    const res = await request(app).post('/api/v1/customer-payments').set(auth(otherOwner)).send({
      customerId: customer.body.data.customer.id,
      paymentDate: '2026-10-06',
      amount: '1',
      paymentMethod: 'UPI',
      moneyAccountId: ctx.phonepe,
      allocations: [],
    });
    expect(res.status).toBe(400);
  });
});
