import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma, resetDatabase, createCompanyWithUsers, login } from '../helpers/db.js';

// LOOKING BEFORE LOCKING, and the other things a business already owns.
//
// Two additions to Phase 15:
//
//   1. Closing a period now VERIFIES it first - the period balances, the whole
//      ledger balances, and the sub-ledgers agree with their control accounts.
//      A period that does not reconcile is not set in stone.
//
//   2. Opening balances now cover other ASSETS, LIABILITIES and EQUITY: a
//      vehicle, a bank loan, capital already introduced. Revenue and expense
//      accounts stay refused, because an opening balance is a position at a
//      moment and must never manufacture profit.

const PASSWORD = 'test-password-123';
const auth = (token) => ({ Authorization: `Bearer ${token}` });

let company;
let adminToken;
let staffToken;

async function accountByCode(companyId, code) {
  return prisma.account.findFirst({ where: { companyId, code } });
}

/** A period covering a whole month, created through the API. */
async function createPeriod(token, name, startDate, endDate) {
  const response = await request(app)
    .post('/api/v1/accounting-periods')
    .set(auth(token))
    .send({ name, startDate, endDate });
  return response;
}

beforeEach(async () => {
  await resetDatabase();
  const fixture = await createCompanyWithUsers('verify');
  company = fixture.company;
  adminToken = await login(app, fixture.admin.email, PASSWORD);
  staffToken = await login(app, fixture.staff.email, PASSWORD);
});

describe('verifying a period before closing it', () => {
  it('reports a clean set of books as ready to close', async () => {
    const period = await createPeriod(adminToken, 'March 2026', '2026-03-01', '2026-03-31');
    const id = period.body.data.period.id;

    const response = await request(app)
      .get(`/api/v1/accounting-periods/${id}/verify`)
      .set(auth(adminToken));

    expect(response.status).toBe(200);
    expect(response.body.data.verification.ok).toBe(true);
    expect(response.body.data.verification.failed).toEqual([]);
  });

  it('names every check it ran, so nobody has to guess what was proved', async () => {
    const period = await createPeriod(adminToken, 'March 2026', '2026-03-01', '2026-03-31');
    const id = period.body.data.period.id;

    const response = await request(app)
      .get(`/api/v1/accounting-periods/${id}/verify`)
      .set(auth(adminToken));

    const keys = response.body.data.verification.checks.map((check) => check.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'PERIOD_BALANCED',
        'LEDGER_BALANCED',
        'RECEIVABLES_RECONCILE',
        'PAYABLES_RECONCILE',
      ]),
    );
  });

  it('still reconciles after opening balances are established', async () => {
    await request(app)
      .post('/api/v1/opening-balances')
      .set(auth(adminToken))
      .send({ asOfDate: '2026-03-01', cash: '25000', bankAccounts: [{ amount: '75000' }] });

    const period = await createPeriod(adminToken, 'March 2026', '2026-03-01', '2026-03-31');
    const response = await request(app)
      .get(`/api/v1/accounting-periods/${period.body.data.period.id}/verify`)
      .set(auth(adminToken));

    expect(response.body.data.verification.ok).toBe(true);
  });

  // Reading whether the books reconcile is not a privileged question.
  it('lets STAFF read the verification', async () => {
    const period = await createPeriod(adminToken, 'March 2026', '2026-03-01', '2026-03-31');

    const response = await request(app)
      .get(`/api/v1/accounting-periods/${period.body.data.period.id}/verify`)
      .set(auth(staffToken));

    expect(response.status).toBe(200);
  });

  it('changes nothing at all', async () => {
    const period = await createPeriod(adminToken, 'March 2026', '2026-03-01', '2026-03-31');
    const id = period.body.data.period.id;

    await request(app).get(`/api/v1/accounting-periods/${id}/verify`).set(auth(adminToken));

    const after = await prisma.accountingPeriod.findUnique({ where: { id } });
    expect(after.status).toBe('OPEN');
    expect(after.closedAt).toBeNull();
  });

  it('never verifies another company period', async () => {
    const other = await createCompanyWithUsers('otherverify');
    const otherToken = await login(app, other.admin.email, PASSWORD);
    const period = await createPeriod(otherToken, 'March 2026', '2026-03-01', '2026-03-31');

    const response = await request(app)
      .get(`/api/v1/accounting-periods/${period.body.data.period.id}/verify`)
      .set(auth(adminToken));

    // 404, not 403 - an id must not be confirmable by comparing error codes.
    expect(response.status).toBe(404);
  });

  it('404s on a period that does not exist', async () => {
    const response = await request(app)
      .get('/api/v1/accounting-periods/00000000-0000-0000-0000-000000000000/verify')
      .set(auth(adminToken));

    expect(response.status).toBe(404);
  });
});

describe('closing runs the verification', () => {
  it('closes a period that reconciles', async () => {
    const period = await createPeriod(adminToken, 'March 2026', '2026-03-01', '2026-03-31');

    const response = await request(app)
      .post(`/api/v1/accounting-periods/${period.body.data.period.id}/close`)
      .set(auth(adminToken));

    expect(response.status).toBe(200);
    expect(response.body.data.period.status).toBe('CLOSED');
  });

  // THE SAFETY NET. The posting service cannot write an unbalanced entry, so
  // this is forced directly into the database to prove the guard actually fires
  // rather than merely existing.
  it('refuses to close a period whose books do not reconcile', async () => {
    const period = await createPeriod(adminToken, 'March 2026', '2026-03-01', '2026-03-31');
    const cash = await accountByCode(company.id, '1000');

    // A receivable with no matching AR journal line: the sub-ledger now says
    // customers owe money that the control account knows nothing about.
    const customer = await prisma.customer.create({
      data: { companyId: company.id, name: 'Orphan Customer' },
    });
    await prisma.customerReceivable.create({
      data: {
        companyId: company.id,
        customerId: customer.id,
        salesInvoiceId: null,
        originalAmount: '5000',
        creditAmount: '0',
        paidAmount: '0',
        outstandingAmount: '5000',
        status: 'OPEN',
      },
    });

    const response = await request(app)
      .post(`/api/v1/accounting-periods/${period.body.data.period.id}/close`)
      .set(auth(adminToken));

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('ACCOUNTING_PERIOD_NOT_RECONCILED');
    expect(response.body.message).toMatch(/Accounts Receivable|reconcile/i);

    // AND IT DID NOT CLOSE. A refused close changes nothing.
    const after = await prisma.accountingPeriod.findUnique({
      where: { id: period.body.data.period.id },
    });
    expect(after.status).toBe('OPEN');
    expect(after.closedAt).toBeNull();
    expect(cash).toBeTruthy();
  });

  it('reports the same failure through the read-only preflight', async () => {
    const period = await createPeriod(adminToken, 'March 2026', '2026-03-01', '2026-03-31');

    const supplier = await prisma.supplier.create({
      data: { companyId: company.id, name: 'Orphan Supplier' },
    });
    await prisma.supplierPayable.create({
      data: {
        companyId: company.id,
        supplierId: supplier.id,
        purchaseId: null,
        originalAmount: '7000',
        creditAmount: '0',
        paidAmount: '0',
        outstandingAmount: '7000',
        status: 'OPEN',
      },
    });

    const response = await request(app)
      .get(`/api/v1/accounting-periods/${period.body.data.period.id}/verify`)
      .set(auth(adminToken));

    expect(response.body.data.verification.ok).toBe(false);
    expect(response.body.data.verification.failed).toContain('PAYABLES_RECONCILE');

    const failing = response.body.data.verification.checks.find(
      (check) => check.key === 'PAYABLES_RECONCILE',
    );
    expect(failing.difference).toBe('7000.00');
  });

  it('closes once the discrepancy is resolved', async () => {
    const period = await createPeriod(adminToken, 'March 2026', '2026-03-01', '2026-03-31');
    const id = period.body.data.period.id;

    const customer = await prisma.customer.create({
      data: { companyId: company.id, name: 'Temporarily Orphan' },
    });
    const receivable = await prisma.customerReceivable.create({
      data: {
        companyId: company.id,
        customerId: customer.id,
        salesInvoiceId: null,
        originalAmount: '5000',
        creditAmount: '0',
        paidAmount: '0',
        outstandingAmount: '5000',
        status: 'OPEN',
      },
    });

    expect(
      (await request(app).post(`/api/v1/accounting-periods/${id}/close`).set(auth(adminToken)))
        .status,
    ).toBe(409);

    await prisma.customerReceivable.delete({ where: { id: receivable.id } });

    expect(
      (await request(app).post(`/api/v1/accounting-periods/${id}/close`).set(auth(adminToken)))
        .status,
    ).toBe(200);
  });

  it('still refuses to close an already closed period, before verifying anything', async () => {
    const period = await createPeriod(adminToken, 'March 2026', '2026-03-01', '2026-03-31');
    const id = period.body.data.period.id;

    await request(app).post(`/api/v1/accounting-periods/${id}/close`).set(auth(adminToken));

    const second = await request(app)
      .post(`/api/v1/accounting-periods/${id}/close`)
      .set(auth(adminToken));

    expect(second.status).toBe(409);
    expect(second.body.code).toBe('ACCOUNTING_PERIOD_ALREADY_CLOSED');
  });
});

describe('opening balances for other assets, liabilities and equity', () => {
  it('records a fixed asset and a loan, and stays balanced', async () => {
    // Real accounts from the company's own chart, created the ordinary way.
    const vehicle = await request(app)
      .post('/api/v1/accounts')
      .set(auth(adminToken))
      .send({ code: '1700', name: 'Vehicles', type: 'ASSET' });

    const loan = await request(app)
      .post('/api/v1/accounts')
      .set(auth(adminToken))
      .send({ code: '2500', name: 'Bank Loan', type: 'LIABILITY' });

    expect(vehicle.status).toBe(201);
    expect(loan.status).toBe(201);

    const response = await request(app)
      .post('/api/v1/opening-balances')
      .set(auth(adminToken))
      .send({
        asOfDate: '2026-03-01',
        cash: '25000',
        otherBalances: [
          { accountId: vehicle.body.data.account.id, amount: '400000', description: 'Delivery van' },
          { accountId: loan.body.data.account.id, amount: '300000', description: 'Vehicle loan' },
        ],
      });

    expect(response.status).toBe(201);

    // The one opening entry balances, with the loan on the credit side.
    const entry = await prisma.journalEntry.findFirst({
      where: { companyId: company.id, sourceType: 'OPENING_BALANCE' },
      include: { lines: true },
    });

    const debit = entry.lines.reduce((total, line) => total + Number(line.debit), 0);
    const credit = entry.lines.reduce((total, line) => total + Number(line.credit), 0);
    expect(debit).toBeCloseTo(credit, 2);

    const vehicleLine = entry.lines.find((line) => line.accountId === vehicle.body.data.account.id);
    const loanLine = entry.lines.find((line) => line.accountId === loan.body.data.account.id);

    // An asset opens as a debit; a liability as a credit. Derived from the
    // account type, never from the request.
    expect(Number(vehicleLine.debit)).toBe(400000);
    expect(Number(loanLine.credit)).toBe(300000);
  });

  it('leaves the balance sheet balanced', async () => {
    const deposit = await request(app)
      .post('/api/v1/accounts')
      .set(auth(adminToken))
      .send({ code: '1600', name: 'Security Deposits', type: 'ASSET' });

    await request(app)
      .post('/api/v1/opening-balances')
      .set(auth(adminToken))
      .send({
        asOfDate: '2026-03-01',
        cash: '10000',
        otherBalances: [{ accountId: deposit.body.data.account.id, amount: '50000' }],
      });

    const sheet = await request(app)
      .get('/api/v1/accounting/balance-sheet')
      .set(auth(adminToken));

    expect(sheet.status).toBe(200);
    // The report answers this itself: Assets = Liabilities + Equity.
    expect(sheet.body.data.balanceSheet.isBalanced).toBe(true);
    expect(sheet.body.data.balanceSheet.difference).toBe('0.00');
  });

  // THE RULE THAT KEEPS AN INITIALIZATION HONEST.
  it('refuses to open a balance on a revenue or expense account', async () => {
    for (const code of ['4000', '5200']) {
      const account = await accountByCode(company.id, code);

      const response = await request(app)
        .post('/api/v1/opening-balances')
        .set(auth(adminToken))
        .send({
          asOfDate: '2026-03-01',
          otherBalances: [{ accountId: account.id, amount: '1000' }],
        });

      expect(response.status, `${code} must be refused`).toBe(422);
      expect(response.body.code).toBe('INVALID_OPENING_ACCOUNT');
    }

    // Nothing was written by any of those attempts.
    expect(
      await prisma.journalEntry.count({ where: { companyId: company.id } }),
    ).toBe(0);
  });

  // Setting a control account here as well as through its own field would
  // double-count it and break the reconciliation the module guarantees.
  it('refuses a control account that has its own dedicated field', async () => {
    for (const [code, field] of [
      ['1000', 'cash'],
      ['1200', 'customers'],
      ['2000', 'suppliers'],
      ['1300', 'inventory'],
    ]) {
      const account = await accountByCode(company.id, code);

      const response = await request(app)
        .post('/api/v1/opening-balances')
        .set(auth(adminToken))
        .send({
          asOfDate: '2026-03-01',
          otherBalances: [{ accountId: account.id, amount: '1000' }],
        });

      expect(response.status, `${code} must be refused`).toBe(422);
      expect(response.body.code).toBe('CONTROLLED_OPENING_ACCOUNT');
      expect(response.body.message).toContain(field);
    }
  });

  it('refuses the same account twice', async () => {
    const asset = await request(app)
      .post('/api/v1/accounts')
      .set(auth(adminToken))
      .send({ code: '1800', name: 'Furniture', type: 'ASSET' });

    const response = await request(app)
      .post('/api/v1/opening-balances')
      .set(auth(adminToken))
      .send({
        asOfDate: '2026-03-01',
        otherBalances: [
          { accountId: asset.body.data.account.id, amount: '1000' },
          { accountId: asset.body.data.account.id, amount: '2000' },
        ],
      });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('DUPLICATE_OPENING_ENTRY');
  });

  it('refuses an account belonging to another company', async () => {
    const other = await createCompanyWithUsers('otherassets');
    const otherToken = await login(app, other.admin.email, PASSWORD);

    const theirAccount = await request(app)
      .post('/api/v1/accounts')
      .set(auth(otherToken))
      .send({ code: '1850', name: 'Their Asset', type: 'ASSET' });

    const response = await request(app)
      .post('/api/v1/opening-balances')
      .set(auth(adminToken))
      .send({
        asOfDate: '2026-03-01',
        otherBalances: [{ accountId: theirAccount.body.data.account.id, amount: '1000' }],
      });

    expect(response.status).toBe(404);
    expect(await prisma.journalEntry.count({ where: { companyId: company.id } })).toBe(0);
  });

  it('counts as "something", so an otherBalances-only initialization is allowed', async () => {
    const asset = await request(app)
      .post('/api/v1/accounts')
      .set(auth(adminToken))
      .send({ code: '1900', name: 'Machinery', type: 'ASSET' });

    const response = await request(app)
      .post('/api/v1/opening-balances')
      .set(auth(adminToken))
      .send({
        asOfDate: '2026-03-01',
        otherBalances: [{ accountId: asset.body.data.account.id, amount: '90000' }],
      });

    expect(response.status).toBe(201);
  });

  it('never turns an opening balance into revenue or profit', async () => {
    const asset = await request(app)
      .post('/api/v1/accounts')
      .set(auth(adminToken))
      .send({ code: '1950', name: 'Other Asset', type: 'ASSET' });

    await request(app)
      .post('/api/v1/opening-balances')
      .set(auth(adminToken))
      .send({
        asOfDate: '2026-03-01',
        cash: '5000',
        otherBalances: [{ accountId: asset.body.data.account.id, amount: '45000' }],
      });

    const pnl = await request(app)
      .get('/api/v1/accounting/profit-loss?dateFrom=2026-01-01&dateTo=2026-12-31')
      .set(auth(adminToken));

    expect(Number(pnl.body.data.profitAndLoss.revenue.total)).toBe(0);
    expect(Number(pnl.body.data.profitAndLoss.netProfit)).toBe(0);
  });
});
