import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import { prisma, resetDatabase, createCompanyWithUsers, login } from '../helpers/db.js';
import { app } from '../../src/app.js';

// Opening balances and accounting periods, end to end.
//
// The figures are the ones from the brief, so every total can be checked by hand:
//
//   Cash          50,000
//   Bank         1,00,000
//   Inventory    2,00,000
//   Customer dues   75,000
//   Supplier dues   60,000
//   -> Opening capital 3,65,000
//
// Every claim a report makes is cross-checked against the general ledger in the
// reconciliation block: an opening balance that does not reach the GL is not an
// opening balance, it is a note.

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const DECIMAL_ZERO = new Prisma.Decimal(0);

const CASH = '1000';
const BANK = '1010';
const AR = '1200';
const INVENTORY = '1300';
const AP = '2000';
const OWNERS_CAPITAL = '3000';
const SALES_REVENUE = '4000';
const COGS = '5000';

let companyA;
let companyB;
let adminA;
let staffA;
let adminB;
let ctxA;
let ctxB;

const get = (token, path) => request(app).get(path).set(auth(token));
const post = (token, path, body) =>
  request(app).post(path).set(auth(token)).send(body ?? {});

async function prepareCompany(token, suffix) {
  const create = (path, body) => request(app).post(path).set(auth(token)).send(body);

  const category = await create('/api/v1/categories', { name: `OBCat ${suffix}` });
  const unit = await create('/api/v1/units', { name: `OBUnit ${suffix}`, shortCode: `OB${suffix}` });
  const warehouse = await create('/api/v1/warehouses', { name: `OBWH ${suffix}`, code: `OW${suffix}` });

  const product = async (n) => {
    const created = await create('/api/v1/products', {
      name: `OBProd${n} ${suffix}`,
      sku: `OB-${suffix}-${n}`,
      categoryId: category.body.data.category.id,
      unitId: unit.body.data.unit.id,
    });
    expect(created.status).toBe(201);
    return created.body.data.product.id;
  };

  const customerA = await create('/api/v1/customers', { name: `OBCustA ${suffix}` });
  const customerB = await create('/api/v1/customers', { name: `OBCustB ${suffix}` });
  const supplierA = await create('/api/v1/suppliers', { name: `OBSupA ${suffix}` });
  const supplierB = await create('/api/v1/suppliers', { name: `OBSupB ${suffix}` });

  // A second bank account, so multi-account opening balances are real here.
  const accounts = await get(token, '/api/v1/accounts?limit=100');
  const bankAccount = accounts.body.data.find((row) => row.code === BANK);
  // Parented under Bank, which is how a business with two banks models it and
  // how the cash book finds the second one.
  const secondBank = await create('/api/v1/accounts', {
    code: '1011',
    name: `Second Bank ${suffix}`,
    type: 'ASSET',
    parentId: bankAccount.id,
  });

  return {
    rice: await product('Rice'),
    oil: await product('Oil'),
    warehouseId: warehouse.body.data.warehouse.id,
    customerA: customerA.body.data.customer.id,
    customerB: customerB.body.data.customer.id,
    supplierA: supplierA.body.data.supplier.id,
    supplierB: supplierB.body.data.supplier.id,
    bankAccountId: bankAccount.id,
    secondBankId: secondBank.body.data?.account?.id ?? null,
  };
}

/** The brief's opening balance set. */
function openingBody(ctx, overrides = {}) {
  return {
    asOfDate: '2026-04-01',
    cash: '50000',
    bankAccounts: [{ amount: '100000' }],
    customers: [
      { customerId: ctx.customerA, amount: '12000', dueDate: '2026-03-01' },
      { customerId: ctx.customerB, amount: '63000' },
    ],
    suppliers: [{ supplierId: ctx.supplierA, amount: '60000' }],
    inventory: [
      // 40 x 1,100 = 44,000 and 1,200 x 130 = 1,56,000 -> 2,00,000 exactly.
      { productId: ctx.rice, warehouseId: ctx.warehouseId, quantity: '40', unitCost: '1100' },
      { productId: ctx.oil, warehouseId: ctx.warehouseId, quantity: '1200', unitCost: '130' },
    ],
    ...overrides,
  };
}

const initialize = (token, body) => post(token, '/api/v1/opening-balances', body);

/** The net movement on one account, debit positive. */
async function balanceOf(companyId, code) {
  const account = await prisma.account.findFirst({ where: { companyId, code } });
  const lines = await prisma.journalLine.findMany({ where: { accountId: account.id } });
  return lines.reduce((total, line) => total.plus(line.debit).minus(line.credit), DECIMAL_ZERO);
}

const createPeriod = (token, body) => post(token, '/api/v1/accounting-periods', body);
const closePeriod = (token, id) => post(token, `/api/v1/accounting-periods/${id}/close`);

beforeAll(async () => {
  await resetDatabase();

  const a = await createCompanyWithUsers('oba');
  const b = await createCompanyWithUsers('obb');

  companyA = a.company;
  companyB = b.company;
  adminA = await login(app, a.admin.email, a.adminPassword);
  staffA = await login(app, a.staff.email, a.staffPassword);
  adminB = await login(app, b.admin.email, b.adminPassword);

  ctxA = await prepareCompany(adminA, 'A');
  ctxB = await prepareCompany(adminB, 'B');
});

beforeEach(async () => {
  await prisma.accountingPeriod.deleteMany();
  await prisma.customerPaymentAllocation.deleteMany();
  await prisma.customerLedgerEntry.deleteMany();
  await prisma.customerPayment.deleteMany();
  await prisma.customerReceivable.deleteMany();
  await prisma.salesReturnItem.deleteMany();
  await prisma.salesReturn.deleteMany();
  await prisma.salesInvoiceItem.deleteMany();
  await prisma.salesInvoice.deleteMany();
  await prisma.supplierPaymentAllocation.deleteMany();
  await prisma.supplierLedgerEntry.deleteMany();
  await prisma.supplierPayment.deleteMany();
  await prisma.supplierPayable.deleteMany();
  await prisma.purchaseReturnItem.deleteMany();
  await prisma.purchaseReturn.deleteMany();
  await prisma.purchaseItem.deleteMany();
  await prisma.purchase.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.journalLine.deleteMany();
  await prisma.journalEntry.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.inventoryBalance.deleteMany();
  await prisma.documentSequence.deleteMany();
  await prisma.companySettings.deleteMany();
});

afterAll(async () => {
  await resetDatabase();
});

// ===========================================================================
// 1-11  Establishing the books
// ===========================================================================

describe('opening balances', () => {
  it('1. reports a fresh company as not initialized', async () => {
    const response = await get(adminA, '/api/v1/opening-balances');

    expect(response.status).toBe(200);
    expect(response.body.data.openingBalances.initialized).toBe(false);
    expect(response.body.data.openingBalances.asOfDate).toBeNull();

    // And there is nothing to show.
    expect((await get(adminA, '/api/v1/opening-balances/details')).status).toBe(404);
  });

  it('2. establishes cash, bank, dues and stock in one balanced entry', async () => {
    const response = await initialize(adminA, openingBody(ctxA));

    expect(response.status).toBe(201);
    const opening = response.body.data.openingBalances;

    expect(opening.initialized).toBe(true);
    expect(opening.asOfDate).toBe('2026-04-01');
    expect(opening.isBalanced).toBe(true);
    // 50,000 + 1,00,000 + 2,00,000 + 75,000 = 4,25,000.
    expect(opening.totalDebit).toBe('425000.00');
    expect(opening.totalCredit).toBe('425000.00');
    expect(opening.journalNumber).toMatch(/^JV-/);
  });

  it('3. writes exactly one journal entry, against Owner’s Capital', async () => {
    await initialize(adminA, openingBody(ctxA));

    const entries = await prisma.journalEntry.findMany({
      where: { companyId: companyA.id },
      include: { lines: { include: { account: true } } },
    });

    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry.sourceType).toBe('OPENING_BALANCE');
    // The company's own id, which is what makes a second one impossible.
    expect(entry.sourceId).toBe(companyA.id);
    expect(entry.totalDebit.equals(entry.totalCredit)).toBe(true);

    const by = Object.fromEntries(entry.lines.map((line) => [line.account.code, line]));
    expect(by[CASH].debit.toFixed(2)).toBe('50000.00');
    expect(by[BANK].debit.toFixed(2)).toBe('100000.00');
    expect(by[INVENTORY].debit.toFixed(2)).toBe('200000.00');
    expect(by[AR].debit.toFixed(2)).toBe('75000.00');
    expect(by[AP].credit.toFixed(2)).toBe('60000.00');
    // Assets 4,25,000 less liabilities 60,000.
    expect(by[OWNERS_CAPITAL].credit.toFixed(2)).toBe('365000.00');
  });

  it('4. creates no sale, no purchase and no expense', async () => {
    await initialize(adminA, openingBody(ctxA));

    // The whole point: none of this happened here.
    expect(await prisma.salesInvoice.count({ where: { companyId: companyA.id } })).toBe(0);
    expect(await prisma.purchase.count({ where: { companyId: companyA.id } })).toBe(0);
    expect(await prisma.expense.count({ where: { companyId: companyA.id } })).toBe(0);

    // And no revenue or cost account was touched.
    expect((await balanceOf(companyA.id, SALES_REVENUE)).toFixed(2)).toBe('0.00');
    expect((await balanceOf(companyA.id, COGS)).toFixed(2)).toBe('0.00');
  });

  it('5. cannot be initialized twice', async () => {
    expect((await initialize(adminA, openingBody(ctxA))).status).toBe(201);

    const again = await initialize(adminA, openingBody(ctxA));

    expect(again.status).toBe(409);
    expect(again.body.code).toBe('OPENING_BALANCES_ALREADY_INITIALIZED');
    expect(await prisma.journalEntry.count({ where: { companyId: companyA.id } })).toBe(1);
  });

  it('6. survives two simultaneous initializations with one entry', async () => {
    // The database is the guarantee, not the code check: the unique key on
    // (companyId, sourceType, sourceId) makes a second entry impossible.
    const [first, second] = await Promise.all([
      initialize(adminA, openingBody(ctxA)),
      initialize(adminA, openingBody(ctxA)),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses[0]).toBe(201);
    expect(statuses[1]).toBeGreaterThanOrEqual(409);

    expect(
      await prisma.journalEntry.count({
        where: { companyId: companyA.id, sourceType: 'OPENING_BALANCE' },
      }),
    ).toBe(1);
    // And the sub-ledgers were written once, not twice.
    expect(await prisma.customerLedgerEntry.count({ where: { companyId: companyA.id } })).toBe(2);
  });

  it('7. establishes cash alone', async () => {
    const response = await initialize(adminA, {
      asOfDate: '2026-04-01',
      cash: '50000',
    });

    expect(response.status).toBe(201);
    expect((await balanceOf(companyA.id, CASH)).toFixed(2)).toBe('50000.00');
    expect((await balanceOf(companyA.id, OWNERS_CAPITAL)).toFixed(2)).toBe('-50000.00');
  });

  it('8. supports several named bank accounts', async () => {
    expect(ctxA.secondBankId).not.toBeNull();

    const response = await initialize(adminA, {
      asOfDate: '2026-04-01',
      bankAccounts: [
        { accountId: ctxA.bankAccountId, amount: '60000' },
        { accountId: ctxA.secondBankId, amount: '40000' },
      ],
    });

    expect(response.status).toBe(201);
    // Two balances, not one meaningless total.
    expect((await balanceOf(companyA.id, BANK)).toFixed(2)).toBe('60000.00');
    expect((await balanceOf(companyA.id, '1011')).toFixed(2)).toBe('40000.00');
    expect(response.body.data.openingBalances.bankAccounts).toHaveLength(2);
  });

  it('9. refuses an empty initialization', async () => {
    const response = await initialize(adminA, { asOfDate: '2026-04-01' });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('EMPTY_OPENING_BALANCES');
    expect(await prisma.journalEntry.count()).toBe(0);
  });

  it('10. refuses a zero or negative amount, and a duplicate party', async () => {
    const zero = await initialize(adminA, { asOfDate: '2026-04-01', cash: '0' });
    expect(zero.status).toBe(422);

    const negative = await initialize(adminA, { asOfDate: '2026-04-01', cash: '-500' });
    expect(negative.status).toBe(400);

    const duplicate = await initialize(adminA, {
      asOfDate: '2026-04-01',
      customers: [
        { customerId: ctxA.customerA, amount: '1000' },
        { customerId: ctxA.customerA, amount: '2000' },
      ],
    });
    expect(duplicate.status).toBe(422);
    expect(duplicate.body.code).toBe('DUPLICATE_OPENING_ENTRY');

    expect(await prisma.journalEntry.count()).toBe(0);
  });

  it('11. shows the full breakdown, read back from where each figure lives', async () => {
    await initialize(adminA, openingBody(ctxA));

    const response = await get(adminA, '/api/v1/opening-balances/details');
    expect(response.status).toBe(200);
    const details = response.body.data.openingBalances;

    expect(details.totals.isBalanced).toBe(true);
    expect(details.customers).toHaveLength(2);
    expect(details.suppliers).toHaveLength(1);
    expect(details.inventory).toHaveLength(2);
    expect(details.journal.length).toBeGreaterThanOrEqual(5);
    expect(details.initializedBy.name).toBe('oba Admin');

    const rice = details.inventory.find((row) => row.productId === ctxA.rice);
    expect(rice.quantity).toBe('40.000');
    expect(rice.unitCost).toBe('1100.00');
    expect(rice.totalValue).toBe('44000.00');
  });
});

// ===========================================================================
// 12-19  Opening balances reach the sub-ledgers and reports
// ===========================================================================

describe('what the rest of the system sees', () => {
  beforeEach(async () => {
    expect((await initialize(adminA, openingBody(ctxA))).status).toBe(201);
  });

  it('12. shows an opening due in the customer credit summary', async () => {
    const credit = (await get(adminA, `/api/v1/customers/${ctxA.customerA}/credit`)).body.data.credit;

    expect(credit.position.outstanding).toBe('12000.00');
    expect(credit.position.invoiceOutstanding).toBe('12000.00');
    expect(credit.position.openInvoiceCount).toBe(1);
  });

  it('13. shows it on the customer statement, labelled as an opening balance', async () => {
    const statement = (await get(adminA, `/api/v1/customers/${ctxA.customerA}/statement`)).body.data
      .statement;

    expect(statement.lines).toHaveLength(1);
    expect(statement.lines[0].type).toBe('OPENING_BALANCE');
    expect(statement.lines[0].debit).toBe('12000.00');
    expect(statement.closingBalance).toBe('12000.00');
    // There is no invoice behind it, and the statement does not pretend there is.
    expect(statement.lines[0].documentNumber).toBeNull();
  });

  it('14. raises a real receivable with no invoice behind it', async () => {
    const receivables = (await get(adminA, '/api/v1/customer-receivables?limit=100')).body.data;

    expect(receivables).toHaveLength(2);
    const opening = receivables.find((row) => row.customer.id === ctxA.customerA);

    expect(opening.salesInvoice).toBeNull();
    expect(opening.source).toBe('OPENING_BALANCE');
    expect(opening.outstandingAmount).toBe('12000.00');
    expect(opening.dueDate).toBe('2026-03-01');
  });

  it('15. ages an opening due like any other, when it has a date', async () => {
    const collections = (await get(adminA, '/api/v1/credit/collections?asOfDate=2026-04-15')).body
      .data.collections;

    expect(collections.outstanding.total).toBe('75000.00');
    // Customer A's 12,000 was due 2026-03-01: 45 days late by 2026-04-15.
    expect(collections.outstanding.overdue).toBe('12000.00');
    // Customer B's 63,000 carries no due date, so it is never overdue.
    expect(collections.outstanding.undated).toBe('63000.00');

    const bucket = Object.fromEntries(collections.ageing.map((row) => [row.bucket, row.amount]));
    expect(bucket['31-60']).toBe('12000.00');
  });

  it('16. shows an opening payable in the supplier statement and summary', async () => {
    const statement = (await get(adminA, `/api/v1/suppliers/${ctxA.supplierA}/statement`)).body.data
      .statement;

    expect(statement.lines).toHaveLength(1);
    expect(statement.lines[0].type).toBe('OPENING_BALANCE');
    expect(statement.lines[0].credit).toBe('60000.00');
    expect(statement.closingBalance).toBe('60000.00');

    const payables = (await get(adminA, '/api/v1/credit/payables-summary')).body.data.payables;
    expect(payables.outstanding.total).toBe('60000.00');
  });

  it('17. shows opening stock in inventory, at the existing valuation', async () => {
    const balances = (await get(adminA, '/api/v1/inventory?limit=100')).body.data;

    expect(balances).toHaveLength(2);
    const rice = balances.find((row) => row.product.id === ctxA.rice);

    expect(rice.quantity).toBe('40.000');
    expect(rice.averageCost).toBe('1100.0000');
    expect(rice.inventoryValue).toBe('44000.00');

    const movements = await prisma.stockMovement.findMany({
      where: { companyId: companyA.id },
    });
    expect(movements.every((row) => row.type === 'OPENING_STOCK')).toBe(true);
  });

  it('18. never treats an opening balance as revenue or profit', async () => {
    const pl = (await get(adminA, '/api/v1/reports/profit-loss')).body.data.report;

    // Not a rupee of it is revenue, cost or expense.
    expect(pl.revenue.total).toBe('0.00');
    expect(pl.costOfGoodsSold.total).toBe('0.00');
    expect(pl.otherExpenses.total).toBe('0.00');
    expect(pl.grossProfit).toBe('0.00');
    expect(pl.netProfit).toBe('0.00');
  });

  it('19. reaches the dashboard, the cash book and the credit book', async () => {
    const dashboard = (await get(adminA, '/api/v1/dashboard')).body.data.dashboard;

    expect(dashboard.balances.customerReceivables.total).toBe('75000.00');
    expect(dashboard.balances.supplierPayables.total).toBe('60000.00');
    expect(dashboard.balances.cashAndBank.totalBalance).toBe('150000.00');
    expect(dashboard.balances.inventory.totalValue).toBe('200000.00');
    // Opening balances are not this month's trading.
    expect(dashboard.thisMonth.sales.total).toBe('0.00');

    const cashBank = (await get(adminA, '/api/v1/reports/cash-bank?limit=100')).body.data.report;
    expect(cashBank.accounts.find((row) => row.code === CASH).closingBalance).toBe('50000.00');
    expect(cashBank.accounts.find((row) => row.code === BANK).closingBalance).toBe('100000.00');
  });
});

// ===========================================================================
// 20-24  Reconciliation
// ===========================================================================

describe('opening balances reconcile with the general ledger', () => {
  beforeEach(async () => {
    expect((await initialize(adminA, openingBody(ctxA))).status).toBe(201);
  });

  it('20. customer outstanding == sub-ledger == AR control account', async () => {
    const receivables = await prisma.customerReceivable.aggregate({
      where: { companyId: companyA.id },
      _sum: { outstandingAmount: true },
    });
    const collections = (await get(adminA, '/api/v1/credit/collections')).body.data.collections;

    expect(collections.outstanding.total).toBe('75000.00');
    expect(receivables._sum.outstandingAmount.toFixed(2)).toBe('75000.00');
    expect((await balanceOf(companyA.id, AR)).toFixed(2)).toBe('75000.00');
  });

  it('21. supplier outstanding == sub-ledger == AP control account', async () => {
    const payables = await prisma.supplierPayable.aggregate({
      where: { companyId: companyA.id },
      _sum: { outstandingAmount: true },
    });
    const summary = (await get(adminA, '/api/v1/credit/payables-summary')).body.data.payables;

    expect(summary.outstanding.total).toBe('60000.00');
    expect(payables._sum.outstandingAmount.toFixed(2)).toBe('60000.00');
    // AP is credit-normal, so a debit-positive balance reads negative.
    expect((await balanceOf(companyA.id, AP)).negated().toFixed(2)).toBe('60000.00');
  });

  it('22. cash and bank reports equal their GL balances', async () => {
    const report = (await get(adminA, '/api/v1/reports/cash-bank?limit=100')).body.data.report;

    expect(report.accounts.find((row) => row.code === CASH).closingBalance).toBe(
      (await balanceOf(companyA.id, CASH)).toFixed(2),
    );
    expect(report.accounts.find((row) => row.code === BANK).closingBalance).toBe(
      (await balanceOf(companyA.id, BANK)).toFixed(2),
    );
  });

  it('23. inventory valuation == inventory GL balance', async () => {
    const valuation = (await get(adminA, '/api/v1/reports/inventory-valuation')).body.data.report;

    expect(valuation.totals.totalValue).toBe('200000.00');
    expect((await balanceOf(companyA.id, INVENTORY)).toFixed(2)).toBe('200000.00');
  });

  it('24. keeps the whole ledger balanced, and the trial balance agrees', async () => {
    const lines = await prisma.journalLine.findMany({ where: { companyId: companyA.id } });
    const totals = lines.reduce(
      (acc, line) => ({ debit: acc.debit.plus(line.debit), credit: acc.credit.plus(line.credit) }),
      { debit: DECIMAL_ZERO, credit: DECIMAL_ZERO },
    );

    expect(totals.debit.toFixed(4)).toBe(totals.credit.toFixed(4));

    const trial = (await get(adminA, '/api/v1/accounting/trial-balance')).body.data.trialBalance;
    expect(trial.isBalanced).toBe(true);
  });
});

// ===========================================================================
// 25-30  Accounting periods
// ===========================================================================

describe('accounting periods', () => {
  const march = { name: 'March 2026', startDate: '2026-03-01', endDate: '2026-03-31' };

  it('25. creates a period', async () => {
    const response = await createPeriod(adminA, march);

    expect(response.status).toBe(201);
    expect(response.body.data.period).toMatchObject({
      name: 'March 2026',
      startDate: '2026-03-01',
      endDate: '2026-03-31',
      status: 'OPEN',
      isClosed: false,
    });
    expect(response.body.data.period.createdBy.name).toBe('oba Admin');
  });

  it('26. refuses a range that ends before it starts', async () => {
    const response = await createPeriod(adminA, {
      name: 'Backwards',
      startDate: '2026-03-31',
      endDate: '2026-03-01',
    });

    expect(response.status).toBe(400);
    expect(await prisma.accountingPeriod.count()).toBe(0);
  });

  it('27. refuses an overlapping period', async () => {
    await createPeriod(adminA, march);

    for (const overlap of [
      { name: 'Mid March', startDate: '2026-03-15', endDate: '2026-04-15' },
      { name: 'Around March', startDate: '2026-02-01', endDate: '2026-04-30' },
      { name: 'Inside March', startDate: '2026-03-10', endDate: '2026-03-20' },
      { name: 'Same March', startDate: '2026-03-01', endDate: '2026-03-31' },
    ]) {
      const response = await createPeriod(adminA, overlap);
      expect(`${overlap.name}:${response.status}`).toBe(`${overlap.name}:422`);
      expect(response.body.code).toBe('ACCOUNTING_PERIOD_OVERLAP');
    }

    // An adjacent period does not overlap and is allowed.
    const april = await createPeriod(adminA, {
      name: 'April 2026',
      startDate: '2026-04-01',
      endDate: '2026-04-30',
    });
    expect(april.status).toBe(201);
  });

  it('28. refuses a duplicate name', async () => {
    await createPeriod(adminA, march);

    const response = await createPeriod(adminA, {
      name: 'March 2026',
      startDate: '2027-03-01',
      endDate: '2027-03-31',
    });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('ACCOUNTING_PERIOD_NAME_TAKEN');
  });

  it('29. closes a period, and will not close it twice', async () => {
    const created = await createPeriod(adminA, march);
    const closed = await closePeriod(adminA, created.body.data.period.id);

    expect(closed.status).toBe(200);
    expect(closed.body.data.period.status).toBe('CLOSED');
    expect(closed.body.data.period.isClosed).toBe(true);
    expect(closed.body.data.period.closedBy.name).toBe('oba Admin');
    expect(closed.body.data.period.closedAt).not.toBeNull();

    const again = await closePeriod(adminA, created.body.data.period.id);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('ACCOUNTING_PERIOD_ALREADY_CLOSED');
  });

  it('30. answers whether a date can be posted', async () => {
    const created = await createPeriod(adminA, march);

    const open = await get(adminA, '/api/v1/accounting-periods/check?date=2026-03-15');
    expect(open.body.data.check.canPost).toBe(true);
    expect(open.body.data.check.period.name).toBe('March 2026');

    await closePeriod(adminA, created.body.data.period.id);

    const closed = await get(adminA, '/api/v1/accounting-periods/check?date=2026-03-15');
    expect(closed.body.data.check.canPost).toBe(false);

    // A date in no period is postable, because periods are opt-in.
    const outside = await get(adminA, '/api/v1/accounting-periods/check?date=2026-09-15');
    expect(outside.body.data.check.period).toBeNull();
    expect(outside.body.data.check.canPost).toBe(true);
  });
});

// ===========================================================================
// 31-38  A closed period blocks every posting path
// ===========================================================================

describe('a closed period', () => {
  const IN_MARCH = '2026-03-15';
  const IN_APRIL = '2026-04-15';

  /** Stock, parties and a closed March. Everything below trades in April. */
  async function tradingCompanyWithClosedMarch() {
    await initialize(adminA, {
      asOfDate: '2026-02-01',
      cash: '500000',
      inventory: [
        { productId: ctxA.rice, warehouseId: ctxA.warehouseId, quantity: '1000', unitCost: '100' },
      ],
    });

    const march = await createPeriod(adminA, {
      name: 'March 2026',
      startDate: '2026-03-01',
      endDate: '2026-03-31',
    });
    await closePeriod(adminA, march.body.data.period.id);

    return march.body.data.period;
  }

  async function draftSale(date) {
    const created = await post(adminA, '/api/v1/sales', {
      customerId: ctxA.customerA,
      warehouseId: ctxA.warehouseId,
      invoiceDate: date,
      items: [{ productId: ctxA.rice, quantity: '1', unitPrice: '5000' }],
    });
    expect(created.status).toBe(201);
    return created.body.data.sale.id;
  }

  async function draftPurchase(date) {
    const created = await post(adminA, '/api/v1/purchases', {
      supplierId: ctxA.supplierA,
      warehouseId: ctxA.warehouseId,
      invoiceNumber: `OB-${Math.random().toString(36).slice(2, 10)}`,
      invoiceDate: date,
      items: [{ productId: ctxA.rice, quantity: '10', unitCost: '100' }],
    });
    expect(created.status).toBe(201);
    return created.body.data.purchase.id;
  }

  beforeEach(async () => {
    await tradingCompanyWithClosedMarch();
  });

  it('31. refuses a sale dated inside it', async () => {
    const id = await draftSale(IN_MARCH);
    const response = await post(adminA, `/api/v1/sales/${id}/post`);

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('ACCOUNTING_PERIOD_CLOSED');
    expect(response.body.message).toContain('March 2026');

    // Nothing happened: still a draft, no stock movement, no receivable.
    expect((await prisma.salesInvoice.findUnique({ where: { id } })).status).toBe('DRAFT');
    expect(await prisma.stockMovement.count({ where: { referenceId: id } })).toBe(0);
    expect(await prisma.customerReceivable.count({ where: { salesInvoiceId: id } })).toBe(0);
  });

  it('32. refuses a purchase dated inside it', async () => {
    const id = await draftPurchase(IN_MARCH);
    const response = await post(adminA, `/api/v1/purchases/${id}/post`);

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('ACCOUNTING_PERIOD_CLOSED');
    expect((await prisma.purchase.findUnique({ where: { id } })).status).toBe('DRAFT');
  });

  it('33. refuses an expense dated inside it', async () => {
    const accounts = await get(adminA, '/api/v1/expenses/categories');
    const rent = accounts.body.data.categories.find((row) => row.code === '5210');

    const created = await post(adminA, '/api/v1/expenses', {
      expenseDate: IN_MARCH,
      expenseAccountId: rent.accountId,
      amount: '2000',
      paymentMode: 'CASH',
    });
    expect(created.status).toBe(201);

    const response = await post(adminA, `/api/v1/expenses/${created.body.data.expense.id}/post`);
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('ACCOUNTING_PERIOD_CLOSED');
  });

  it('34. refuses a customer receipt dated inside it', async () => {
    const created = await post(adminA, '/api/v1/customer-payments', {
      customerId: ctxA.customerA,
      paymentDate: IN_MARCH,
      amount: '3000',
      paymentMethod: 'CASH',
    });
    expect(created.status).toBe(201);

    const response = await post(
      adminA,
      `/api/v1/customer-payments/${created.body.data.payment.id}/post`,
    );
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('ACCOUNTING_PERIOD_CLOSED');
    expect(await prisma.customerLedgerEntry.count({ where: { entryType: 'PAYMENT' } })).toBe(0);
  });

  it('35. refuses a supplier payment dated inside it', async () => {
    const created = await post(adminA, '/api/v1/supplier-payments', {
      supplierId: ctxA.supplierA,
      paymentDate: IN_MARCH,
      amount: '5000',
      paymentMethod: 'CASH',
    });
    expect(created.status).toBe(201);

    const response = await post(
      adminA,
      `/api/v1/supplier-payments/${created.body.data.payment.id}/post`,
    );
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('ACCOUNTING_PERIOD_CLOSED');
  });

  it('36. refuses a sales return and a journal reversal dated inside it', async () => {
    // A sale in April, returned in March: the return is the posting being dated
    // into the closed period, and it is the one that must be refused.
    const saleId = await draftSale(IN_APRIL);
    expect((await post(adminA, `/api/v1/sales/${saleId}/post`)).status).toBe(200);

    const sale = (await get(adminA, `/api/v1/sales/${saleId}`)).body.data.sale;
    const created = await post(adminA, '/api/v1/sales-returns', {
      salesInvoiceId: saleId,
      returnDate: IN_MARCH,
      items: [{ salesInvoiceItemId: sale.items[0].id, quantity: '1' }],
    });
    expect(created.status).toBe(201);

    const returned = await post(
      adminA,
      `/api/v1/sales-returns/${created.body.data.salesReturn.id}/post`,
    );
    expect(returned.status).toBe(422);
    expect(returned.body.code).toBe('ACCOUNTING_PERIOD_CLOSED');

    // A journal reversal carries the ORIGINAL entry's date - it has no date of
    // its own - so the rule that matters is that an entry inside a closed period
    // can no longer be reversed. Close April and the April sale becomes final.
    const april = await createPeriod(adminA, {
      name: 'April 2026',
      startDate: '2026-04-01',
      endDate: '2026-04-30',
    });
    await closePeriod(adminA, april.body.data.period.id);

    const entry = await prisma.journalEntry.findFirst({
      where: { companyId: companyA.id, sourceType: 'SALES_INVOICE' },
    });
    const reversal = await post(adminA, `/api/v1/journal-entries/${entry.id}/reverse`, {
      description: 'Correction',
    });

    expect(reversal.status).toBe(422);
    expect(reversal.body.code).toBe('ACCOUNTING_PERIOD_CLOSED');
    // And the original entry is exactly as it was.
    expect(await prisma.journalEntry.count({ where: { sourceType: 'REVERSAL' } })).toBe(0);
  });

  it('37. rewrites no history, and shifts no date', async () => {
    // A sale posted in April before March was closed stays exactly as it was.
    const before = await prisma.journalEntry.findMany({ where: { companyId: companyA.id } });

    const id = await draftSale(IN_MARCH);
    await post(adminA, `/api/v1/sales/${id}/post`);

    const after = await prisma.journalEntry.findMany({ where: { companyId: companyA.id } });

    // No entry created, none modified, and nothing silently moved to April.
    expect(after).toHaveLength(before.length);
    expect((await prisma.salesInvoice.findUnique({ where: { id } })).invoiceDate.toISOString().slice(0, 10)).toBe(
      IN_MARCH,
    );
  });

  it('38. still allows everything in an open period', async () => {
    // April is not closed - and is not even declared as a period, which is the
    // ordinary case for a company that closes only the months it has finished.
    const id = await draftSale(IN_APRIL);
    expect((await post(adminA, `/api/v1/sales/${id}/post`)).status).toBe(200);

    const purchaseId = await draftPurchase(IN_APRIL);
    expect((await post(adminA, `/api/v1/purchases/${purchaseId}/post`)).status).toBe(200);

    // An explicitly OPEN period behaves the same way.
    const april = await createPeriod(adminA, {
      name: 'April 2026',
      startDate: '2026-04-01',
      endDate: '2026-04-30',
    });
    expect(april.body.data.period.status).toBe('OPEN');

    const another = await draftSale(IN_APRIL);
    expect((await post(adminA, `/api/v1/sales/${another}/post`)).status).toBe(200);
  });
});

// ===========================================================================
// 39-42  Reopening, strict mode, and concurrency
// ===========================================================================

describe('period behaviour at the edges', () => {
  it('39. reopens a closed period, attributed, and posting works again', async () => {
    await initialize(adminA, { asOfDate: '2026-02-01', cash: '500000' });

    const march = await createPeriod(adminA, {
      name: 'March 2026',
      startDate: '2026-03-01',
      endDate: '2026-03-31',
    });
    await closePeriod(adminA, march.body.data.period.id);

    const reopened = await post(
      adminA,
      `/api/v1/accounting-periods/${march.body.data.period.id}/reopen`,
      { reason: 'Closed the wrong month' },
    );

    expect(reopened.status).toBe(200);
    expect(reopened.body.data.period.status).toBe('OPEN');
    expect(reopened.body.data.period.reopenReason).toBe('Closed the wrong month');
    expect(reopened.body.data.period.reopenedBy.name).toBe('oba Admin');
    // The close is kept: this period was closed by someone and reopened by someone.
    expect(reopened.body.data.period.closedBy).not.toBeNull();

    // Reopening an open period is refused.
    expect(
      (await post(adminA, `/api/v1/accounting-periods/${march.body.data.period.id}/reopen`)).status,
    ).toBe(409);
  });

  it('40. refuses a posting outside every period when strict mode is on', async () => {
    await initialize(adminA, { asOfDate: '2026-02-01', cash: '500000' });
    await prisma.companySettings.upsert({
      where: { companyId: companyA.id },
      update: { requireOpenPeriod: true },
      create: { companyId: companyA.id, requireOpenPeriod: true },
    });

    await createPeriod(adminA, {
      name: 'April 2026',
      startDate: '2026-04-01',
      endDate: '2026-04-30',
    });

    const outside = await post(adminA, '/api/v1/expenses', {
      expenseDate: '2026-09-15',
      expenseAccountId: (await get(adminA, '/api/v1/expenses/categories')).body.data.categories[0]
        .accountId,
      amount: '100',
      paymentMode: 'CASH',
    });
    const refused = await post(adminA, `/api/v1/expenses/${outside.body.data.expense.id}/post`);

    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe('NO_OPEN_ACCOUNTING_PERIOD');

    // Inside the declared period it posts normally.
    const inside = await post(adminA, '/api/v1/expenses', {
      expenseDate: '2026-04-15',
      expenseAccountId: (await get(adminA, '/api/v1/expenses/categories')).body.data.categories[0]
        .accountId,
      amount: '100',
      paymentMode: 'CASH',
    });
    expect((await post(adminA, `/api/v1/expenses/${inside.body.data.expense.id}/post`)).status).toBe(
      200,
    );
  });

  it('41. resolves two simultaneous closes to one winner', async () => {
    const march = await createPeriod(adminA, {
      name: 'March 2026',
      startDate: '2026-03-01',
      endDate: '2026-03-31',
    });
    const id = march.body.data.period.id;

    const [a, b] = await Promise.all([closePeriod(adminA, id), closePeriod(adminA, id)]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await prisma.accountingPeriod.findUnique({ where: { id } })).status).toBe('CLOSED');
  });

  it('42. never lets a posting and a close both succeed for the same date', async () => {
    await initialize(adminA, { asOfDate: '2026-02-01', cash: '500000' });

    const march = await createPeriod(adminA, {
      name: 'March 2026',
      startDate: '2026-03-01',
      endDate: '2026-03-31',
    });

    const expenseCategory = (await get(adminA, '/api/v1/expenses/categories')).body.data
      .categories[0].accountId;
    const draft = await post(adminA, '/api/v1/expenses', {
      expenseDate: '2026-03-15',
      expenseAccountId: expenseCategory,
      amount: '2000',
      paymentMode: 'CASH',
    });

    const [posting, closing] = await Promise.all([
      post(adminA, `/api/v1/expenses/${draft.body.data.expense.id}/post`),
      closePeriod(adminA, march.body.data.period.id),
    ]);

    // The close always succeeds; the posting either beat it or was refused.
    expect(closing.status).toBe(200);
    expect([200, 422]).toContain(posting.status);

    // Whichever way it went, the books are consistent: an entry exists only if
    // the posting reported success.
    const entries = await prisma.journalEntry.count({
      where: { companyId: companyA.id, sourceType: 'EXPENSE' },
    });
    expect(entries).toBe(posting.status === 200 ? 1 : 0);
  });
});

// ===========================================================================
// 43-47  The acceptance scenarios, GST and non-GST
// ===========================================================================

describe('the acceptance scenarios', () => {
  it('43. runs the whole non-GST workflow with no GST data at all', async () => {
    const company = await prisma.company.findUnique({ where: { id: companyA.id } });
    expect(company.gstin).toBeNull();
    expect(company.stateCode).toBeNull();

    // Initialize exactly the brief's figures - no GSTIN, no HSN, no state code.
    const opening = await initialize(adminA, openingBody(ctxA));
    expect(opening.status).toBe(201);
    expect(JSON.stringify(opening.body)).not.toMatch(/gstin|hsn|placeOfSupply|cgst|sgst|igst/i);

    // Then trade: sell 5,000, receive 3,000, pay 10,000, spend 2,000.
    const saleDraft = await post(adminA, '/api/v1/sales', {
      customerId: ctxA.customerA,
      warehouseId: ctxA.warehouseId,
      invoiceDate: '2026-04-10',
      items: [{ productId: ctxA.rice, quantity: '1', unitPrice: '5000' }],
    });
    expect((await post(adminA, `/api/v1/sales/${saleDraft.body.data.sale.id}/post`)).status).toBe(200);

    const receipt = await post(adminA, '/api/v1/customer-payments', {
      customerId: ctxA.customerA,
      paymentDate: '2026-04-11',
      amount: '3000',
      paymentMethod: 'CASH',
    });
    expect(
      (await post(adminA, `/api/v1/customer-payments/${receipt.body.data.payment.id}/post`)).status,
    ).toBe(200);

    const payment = await post(adminA, '/api/v1/supplier-payments', {
      supplierId: ctxA.supplierA,
      paymentDate: '2026-04-12',
      amount: '10000',
      paymentMethod: 'CASH',
    });
    expect(
      (await post(adminA, `/api/v1/supplier-payments/${payment.body.data.payment.id}/post`)).status,
    ).toBe(200);

    const expense = await post(adminA, '/api/v1/expenses', {
      expenseDate: '2026-04-13',
      expenseAccountId: (await get(adminA, '/api/v1/expenses/categories')).body.data.categories.find(
        (row) => row.code === '5210',
      ).accountId,
      amount: '2000',
      paymentMode: 'CASH',
    });
    expect((await post(adminA, `/api/v1/expenses/${expense.body.data.expense.id}/post`)).status).toBe(
      200,
    );

    // --- and now every balance, by hand ---------------------------------
    // Cash: 50,000 opening + 3,000 received - 10,000 paid - 2,000 expense.
    expect((await balanceOf(companyA.id, CASH)).toFixed(2)).toBe('41000.00');
    // AR: 75,000 opening + 5,000 sale. The 3,000 receipt was not allocated to
    // any invoice, so it is customer credit sitting in Customer Advances rather
    // than a reduction of the receivable - which is the existing rule, and the
    // reason the two figures differ by exactly 3,000.
    expect((await balanceOf(companyA.id, AR)).toFixed(2)).toBe('80000.00');
    expect((await balanceOf(companyA.id, '2200')).negated().toFixed(2)).toBe('3000.00');
    // AP: 60,000 opening, unchanged. The 10,000 payment was not allocated to any
    // bill, so it sits in Advance to Suppliers - the mirror of the receipt above,
    // and the same existing rule.
    expect((await balanceOf(companyA.id, AP)).negated().toFixed(2)).toBe('60000.00');
    expect((await balanceOf(companyA.id, '1400')).toFixed(2)).toBe('10000.00');

    const pl = (await get(adminA, '/api/v1/reports/profit-loss')).body.data.report;
    // ONLY the 5,000 sale is revenue. Not one rupee of the opening balances.
    expect(pl.revenue.total).toBe('5000.00');
    expect(pl.otherExpenses.total).toBe('2000.00');

    const trial = (await get(adminA, '/api/v1/accounting/trial-balance')).body.data.trialBalance;
    expect(trial.isBalanced).toBe(true);

    // Every read the brief lists works.
    for (const path of [
      '/api/v1/dashboard',
      '/api/v1/reports/cash-bank',
      '/api/v1/reports/inventory-valuation',
      '/api/v1/credit/collections',
      '/api/v1/credit/payables-summary',
      `/api/v1/customers/${ctxA.customerA}/statement`,
      `/api/v1/suppliers/${ctxA.supplierA}/statement`,
    ]) {
      expect(`${path}:${(await get(adminA, path)).status}`).toBe(`${path}:200`);
    }
  });

  it('44. runs the identical workflow for a GST-registered company', async () => {
    await request(app)
      .patch('/api/v1/tax/profile')
      .set(auth(adminB))
      .send({ stateCode: '27', gstin: '27AAPFU0939F1ZV', registrationType: 'REGULAR' });

    const opening = await initialize(adminB, openingBody(ctxB));

    // Byte-identical behaviour: GST changed nothing about initialization.
    expect(opening.status).toBe(201);
    expect(opening.body.data.openingBalances.totalDebit).toBe('425000.00');
    expect(opening.body.data.openingBalances.isBalanced).toBe(true);

    const entry = await prisma.journalEntry.findFirst({
      where: { companyId: companyB.id, sourceType: 'OPENING_BALANCE' },
      include: { lines: { include: { account: true } } },
    });
    // No tax account anywhere in an opening entry, registered or not.
    const codes = entry.lines.map((line) => line.account.code);
    for (const tax of ['1500', '1510', '1520', '1530', '2100', '2110', '2120', '2130']) {
      expect(codes).not.toContain(tax);
    }

    // And GST itself still works.
    expect(
      (await get(adminB, '/api/v1/tax/returns/gstr-3b?fromDate=2026-04-01&toDate=2026-04-30')).status,
    ).toBe(200);

    await prisma.company.update({
      where: { id: companyB.id },
      data: { stateCode: null, gstin: null },
    });
  });

  it('45. collects an opening due through an ordinary receipt', async () => {
    // This is what makes an opening receivable a real one rather than a note:
    // it can be allocated against and settled like any invoice.
    await initialize(adminA, openingBody(ctxA));

    const receivable = (await get(adminA, '/api/v1/customer-receivables?limit=100')).body.data.find(
      (row) => row.customer.id === ctxA.customerA,
    );

    const receipt = await post(adminA, '/api/v1/customer-payments', {
      customerId: ctxA.customerA,
      paymentDate: '2026-04-11',
      amount: '12000',
      paymentMethod: 'CASH',
      allocations: [{ receivableId: receivable.id, amount: '12000' }],
    });
    expect(receipt.status).toBe(201);

    const posted = await post(
      adminA,
      `/api/v1/customer-payments/${receipt.body.data.payment.id}/post`,
    );
    expect(posted.status).toBe(200);
    expect(posted.body.data.payment.allocations[0].source).toBe('OPENING_BALANCE');
    expect(posted.body.data.payment.allocations[0].salesInvoice).toBeNull();

    const after = await prisma.customerReceivable.findUnique({ where: { id: receivable.id } });
    expect(after.outstandingAmount.toFixed(2)).toBe('0.00');
    expect(after.status).toBe('PAID');

    // And the AR control account followed.
    expect((await balanceOf(companyA.id, AR)).toFixed(2)).toBe('63000.00');
  });

  it('46. keeps opening stock out of profit until it is actually sold', async () => {
    await initialize(adminA, {
      asOfDate: '2026-04-01',
      inventory: [
        { productId: ctxA.rice, warehouseId: ctxA.warehouseId, quantity: '40', unitCost: '1100' },
      ],
    });

    // Before selling: stock on the balance sheet, nothing in the P&L.
    let pl = (await get(adminA, '/api/v1/reports/profit-loss')).body.data.report;
    expect(pl.costOfGoodsSold.total).toBe('0.00');
    expect((await balanceOf(companyA.id, INVENTORY)).toFixed(2)).toBe('44000.00');

    const sale = await post(adminA, '/api/v1/sales', {
      customerId: ctxA.customerA,
      warehouseId: ctxA.warehouseId,
      invoiceDate: '2026-04-10',
      items: [{ productId: ctxA.rice, quantity: '10', unitPrice: '1500' }],
    });
    expect((await post(adminA, `/api/v1/sales/${sale.body.data.sale.id}/post`)).status).toBe(200);

    // After selling 10 of 40: COGS is 10 x 1,100 at the opening cost, and gross
    // profit is 15,000 - 11,000. The opening stock became cost only when sold.
    pl = (await get(adminA, '/api/v1/reports/profit-loss')).body.data.report;
    expect(pl.revenue.total).toBe('15000.00');
    expect(pl.costOfGoodsSold.total).toBe('11000.00');
    expect(pl.grossProfit).toBe('4000.00');
    expect((await balanceOf(companyA.id, INVENTORY)).toFixed(2)).toBe('33000.00');
  });

  it('47. refuses an initialization dated into a closed period', async () => {
    const march = await createPeriod(adminA, {
      name: 'March 2026',
      startDate: '2026-03-01',
      endDate: '2026-03-31',
    });
    await closePeriod(adminA, march.body.data.period.id);

    // Opening balances are a posting like any other and obey the same rule.
    const response = await initialize(adminA, {
      asOfDate: '2026-03-15',
      cash: '50000',
    });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('ACCOUNTING_PERIOD_CLOSED');
    expect(await prisma.journalEntry.count({ where: { companyId: companyA.id } })).toBe(0);
    // And the sub-ledger rows rolled back with it.
    expect(await prisma.customerLedgerEntry.count({ where: { companyId: companyA.id } })).toBe(0);
  });
});

// ===========================================================================
// 48-51  Tenant isolation and RBAC
// ===========================================================================

describe('access and isolation', () => {
  it('48. never lets one company touch another’s periods', async () => {
    const march = await createPeriod(adminA, {
      name: 'March 2026',
      startDate: '2026-03-01',
      endDate: '2026-03-31',
    });
    const id = march.body.data.period.id;

    expect((await get(adminB, `/api/v1/accounting-periods/${id}`)).status).toBe(404);
    expect((await closePeriod(adminB, id)).status).toBe(404);
    expect((await post(adminB, `/api/v1/accounting-periods/${id}/reopen`)).status).toBe(404);

    // B's own list is empty, and A's period is untouched.
    expect((await get(adminB, '/api/v1/accounting-periods')).body.data).toHaveLength(0);
    expect((await prisma.accountingPeriod.findUnique({ where: { id } })).status).toBe('OPEN');

    // Company B closing its OWN March does not stop A posting in March.
    const marchB = await createPeriod(adminB, {
      name: 'March 2026',
      startDate: '2026-03-01',
      endDate: '2026-03-31',
    });
    expect(marchB.status).toBe(201);
    await closePeriod(adminB, marchB.body.data.period.id);

    const check = await get(adminA, '/api/v1/accounting-periods/check?date=2026-03-15');
    expect(check.body.data.check.canPost).toBe(true);
  });

  it('49. never lets one company see or seed another’s opening balances', async () => {
    await initialize(adminA, openingBody(ctxA));

    const status = await get(adminB, '/api/v1/opening-balances');
    expect(status.body.data.openingBalances.initialized).toBe(false);
    expect((await get(adminB, '/api/v1/opening-balances/details')).status).toBe(404);

    // B cannot name A's customer, supplier, product or account.
    for (const [field, body] of [
      ['customer', { asOfDate: '2026-04-01', customers: [{ customerId: ctxA.customerA, amount: '1000' }] }],
      ['supplier', { asOfDate: '2026-04-01', suppliers: [{ supplierId: ctxA.supplierA, amount: '1000' }] }],
      [
        'product',
        {
          asOfDate: '2026-04-01',
          inventory: [
            { productId: ctxA.rice, warehouseId: ctxA.warehouseId, quantity: '1', unitCost: '1' },
          ],
        },
      ],
      ['account', { asOfDate: '2026-04-01', bankAccounts: [{ accountId: ctxA.bankAccountId, amount: '1000' }] }],
    ]) {
      const response = await initialize(adminB, body);
      expect(`${field}:${response.status}`).toBe(`${field}:404`);
    }

    expect(await prisma.journalEntry.count({ where: { companyId: companyB.id } })).toBe(0);
  });

  it('50. requires ADMIN to initialize, close or reopen', async () => {
    const march = await createPeriod(adminA, {
      name: 'March 2026',
      startDate: '2026-03-01',
      endDate: '2026-03-31',
    });

    // A staff member must not be able to freeze the books - nor to thaw them.
    expect((await initialize(staffA, openingBody(ctxA))).status).toBe(403);
    expect(
      (await post(staffA, '/api/v1/accounting-periods', {
        name: 'April 2026',
        startDate: '2026-04-01',
        endDate: '2026-04-30',
      })).status,
    ).toBe(403);
    expect((await closePeriod(staffA, march.body.data.period.id)).status).toBe(403);
    expect(
      (await post(staffA, `/api/v1/accounting-periods/${march.body.data.period.id}/reopen`)).status,
    ).toBe(403);

    expect(await prisma.journalEntry.count()).toBe(0);
    expect((await prisma.accountingPeriod.findUnique({ where: { id: march.body.data.period.id } })).status).toBe(
      'OPEN',
    );
  });

  it('51. lets STAFF read, and refuses an unauthenticated request', async () => {
    await initialize(adminA, openingBody(ctxA));
    await createPeriod(adminA, { name: 'March 2026', startDate: '2026-03-01', endDate: '2026-03-31' });

    const paths = [
      '/api/v1/opening-balances',
      '/api/v1/opening-balances/details',
      '/api/v1/accounting-periods',
      '/api/v1/accounting-periods/check?date=2026-03-15',
    ];

    for (const path of paths) {
      expect(`staff ${path}:${(await get(staffA, path)).status}`).toBe(`staff ${path}:200`);
      expect(`anon ${path}:${(await request(app).get(path)).status}`).toBe(`anon ${path}:401`);
    }

    // And the writes need a token too.
    expect((await request(app).post('/api/v1/opening-balances').send({})).status).toBe(401);
    expect((await request(app).post('/api/v1/accounting-periods').send({})).status).toBe(401);
  });
});
