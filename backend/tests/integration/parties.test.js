import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import {
  prisma,
  resetDatabase,
  createCompanyWithUsers,
  createPlatformUser,
  login,
} from '../helpers/db.js';

// THE PARTY MASTER.
//
//   Party
//     ├── Customer   receivables, customer ledger, money received
//     └── Supplier   payables, supplier ledger, money paid
//
// What these tests hold the feature to:
//   - a party can be a customer, a supplier, or both, and the old /customers and
//     /suppliers endpoints keep working exactly as before;
//   - the two sides of a "both" party are separate debts: a receipt never
//     touches the payable, a payment never touches the receivable, and nothing
//     nets one against the other;
//   - a party is master data: creating, editing or linking one posts nothing
//     and rewrites no posted document;
//   - possible duplicates are shown, never merged;
//   - a bill's party is matched across sides but never chosen for the shop;
//   - one company never sees another's parties.

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const PASSWORD = 'test-password-123';

let companyA;
let adminA;
let staffA;
let adminB;
let platformToken;
let ctx;

async function prepareCompany(token, suffix) {
  const category = await request(app)
    .post('/api/v1/categories')
    .set(auth(token))
    .send({ name: `PartyCat ${suffix}` });
  const unit = await request(app)
    .post('/api/v1/units')
    .set(auth(token))
    .send({ name: `PartyUnit ${suffix}`, shortCode: `PT${suffix}` });
  const product = await request(app)
    .post('/api/v1/products')
    .set(auth(token))
    .send({
      name: `Party Product ${suffix}`,
      sku: `PTSKU-${suffix}`,
      categoryId: category.body.data.category.id,
      unitId: unit.body.data.unit.id,
    });
  const warehouse = await request(app)
    .post('/api/v1/warehouses')
    .set(auth(token))
    .send({ name: `Party WH ${suffix}`, code: `PW${suffix}` });

  return {
    productId: product.body.data.product.id,
    warehouseId: warehouse.body.data.warehouse.id,
  };
}

const createParty = (token, body) => request(app).post('/api/v1/parties').set(auth(token)).send(body);
const getParty = (token, id) => request(app).get(`/api/v1/parties/${id}`).set(auth(token));

async function postPurchase(token, supplierId, total, quantity = '2') {
  const unitCost = String(Number(total) / Number(quantity));
  const created = await request(app)
    .post('/api/v1/purchases')
    .set(auth(token))
    .send({
      supplierId,
      warehouseId: ctx.warehouseId,
      invoiceNumber: `PTY-${Math.random().toString(36).slice(2, 10)}`,
      invoiceDate: '2026-09-01',
      dueDate: '2026-09-10',
      items: [{ productId: ctx.productId, quantity, unitCost }],
    });
  expect(created.status).toBe(201);
  const posted = await request(app)
    .post(`/api/v1/purchases/${created.body.data.purchase.id}/post`)
    .set(auth(token));
  expect(posted.status).toBe(200);
  return posted.body.data.purchase;
}

async function postSale(token, customerId, total) {
  const created = await request(app)
    .post('/api/v1/sales')
    .set(auth(token))
    .send({
      customerId,
      warehouseId: ctx.warehouseId,
      invoiceDate: '2026-09-02',
      dueDate: '2026-09-12',
      items: [{ productId: ctx.productId, quantity: '1', unitPrice: total }],
    });
  expect(created.status).toBe(201);
  const posted = await request(app)
    .post(`/api/v1/sales/${created.body.data.sale.id}/post`)
    .set(auth(token));
  expect(posted.status).toBe(200);
  return posted.body.data.sale;
}

function createReviewBill(companyId, uploadedById, reviewedData, direction) {
  return prisma.bill.create({
    data: {
      companyId,
      direction,
      status: 'REVIEW',
      originalFilename: 'bill.pdf',
      mimeType: 'application/pdf',
      fileSize: 1024,
      storageKey: `${companyId}/2026-09/${Math.random().toString(36).slice(2)}.pdf`,
      reviewedData,
      uploadedById,
    },
    select: { id: true },
  });
}

beforeAll(async () => {
  await resetDatabase();

  companyA = await createCompanyWithUsers('partya');
  const companyB = await createCompanyWithUsers('partyb');

  adminA = await login(app, companyA.admin.email, PASSWORD);
  staffA = await login(app, companyA.staff.email, PASSWORD);
  adminB = await login(app, companyB.admin.email, PASSWORD);

  const platform = await createPlatformUser({ email: 'ops@party.test', role: 'PLATFORM_ADMIN' });
  platformToken = await login(app, 'ops@party.test', platform.password);

  ctx = await prepareCompany(adminA, 'A');
});

describe('creating parties', () => {
  it('creates a customer-only party with a customer record and no supplier', async () => {
    const res = await createParty(adminA, {
      name: 'Rahul Store',
      phone: '9000000001',
      relationship: 'CUSTOMER',
    });

    expect(res.status).toBe(201);
    const party = res.body.data.party;
    expect(party).toMatchObject({ relationship: 'CUSTOMER', isCustomer: true, isSupplier: false });
    expect(party.supplierId).toBeNull();
    expect(party.customer.receivable).toBe('0.00');
    expect(party.supplier).toBeNull();

    const customer = await prisma.customer.findUnique({ where: { id: party.customerId } });
    expect(customer).toMatchObject({ partyId: party.id, name: 'Rahul Store', companyId: companyA.company.id });
  });

  it('creates a supplier-only party', async () => {
    const res = await createParty(adminA, {
      name: 'ABC Distributor',
      phone: '9000000002',
      relationship: 'SUPPLIER',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.party).toMatchObject({ relationship: 'SUPPLIER', isCustomer: false, isSupplier: true });
    expect(res.body.data.party.customerId).toBeNull();
    expect(await prisma.supplier.count({ where: { partyId: res.body.data.party.id } })).toBe(1);
  });

  it('creates a party that is both, with one customer and one supplier sharing its details', async () => {
    const res = await createParty(adminA, {
      name: 'XYZ Traders',
      phone: '9000000003',
      email: 'xyz@example.com',
      city: 'Kolkata',
      relationship: 'BOTH',
      customer: { creditDays: 15 },
      supplier: { creditDays: 30 },
    });

    expect(res.status).toBe(201);
    const party = res.body.data.party;
    expect(party.relationship).toBe('BOTH');
    expect(party.customer.creditDays).toBe(15);
    expect(party.supplier.creditDays).toBe(30);

    const [customer, supplier] = await Promise.all([
      prisma.customer.findUnique({ where: { id: party.customerId } }),
      prisma.supplier.findUnique({ where: { id: party.supplierId } }),
    ]);
    expect(customer).toMatchObject({ name: 'XYZ Traders', phone: '9000000003', email: 'xyz@example.com' });
    expect(supplier).toMatchObject({ name: 'XYZ Traders', phone: '9000000003', email: 'xyz@example.com' });
  });

  it('does not need a GSTIN, and a non-GST party is unregistered on both sides', async () => {
    const res = await createParty(adminA, { name: 'Local Kirana', relationship: 'BOTH' });

    expect(res.status).toBe(201);
    expect(res.body.data.party.gstin).toBeNull();
    expect(res.body.data.party.customer.gstRegistrationType).toBe('UNREGISTERED');
    expect(res.body.data.party.supplier.gstRegistrationType).toBe('UNREGISTERED');
  });

  it('checks a GSTIN only when one is given, and treats a GSTIN holder as registered', async () => {
    const bad = await createParty(adminA, { name: 'Bad Gst Co', gstin: 'NOTAGSTIN', relationship: 'CUSTOMER' });
    expect(bad.status).toBe(400);

    const good = await createParty(adminA, {
      name: 'Gst Wholesale',
      gstin: '19ABCDE1234F1Z5',
      relationship: 'SUPPLIER',
    });
    expect(good.status).toBe(201);
    expect(good.body.data.party.supplier.gstRegistrationType).toBe('REGULAR');
  });

  it('requires a relationship', async () => {
    const res = await createParty(adminA, { name: 'Nobody Yet' });
    expect(res.status).toBe(400);
  });

  it('writes no journal entry: a party is master data', async () => {
    const before = await prisma.journalEntry.count({ where: { companyId: companyA.company.id } });
    const res = await createParty(adminA, {
      name: 'No Posting Co',
      relationship: 'BOTH',
      customer: { openingBalance: '500' },
    });
    expect(res.status).toBe(201);
    expect(await prisma.journalEntry.count({ where: { companyId: companyA.company.id } })).toBe(before);
  });
});

describe('duplicate prevention', () => {
  it('refuses a possible duplicate by phone and says which party it looks like', async () => {
    const res = await createParty(adminA, {
      name: 'Rahul General',
      phone: '+91 90000 00001',
      relationship: 'SUPPLIER',
    });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PARTY_POSSIBLE_DUPLICATE');
    expect(res.body.errors[0]).toMatchObject({ name: 'Rahul Store', reasons: ['phone'] });
  });

  it('shows a same-name party but does not merge it', async () => {
    const res = await createParty(adminA, { name: 'xyz  traders.', relationship: 'CUSTOMER' });
    expect(res.status).toBe(409);
    expect(res.body.errors[0].reasons).toContain('name');
    // Still exactly one party with that name.
    expect(await prisma.party.count({ where: { companyId: companyA.company.id, name: 'XYZ Traders' } })).toBe(1);
  });

  it('creates the new party when the shop confirms it is a different one', async () => {
    const res = await createParty(adminA, {
      name: 'Rahul Traders',
      phone: '9000000001',
      relationship: 'SUPPLIER',
      allowDuplicate: true,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.party.id).not.toBe(undefined);
  });

  it('lists possible matches for the form, strongest first', async () => {
    const res = await request(app)
      .get('/api/v1/parties/possible-matches')
      .query({ name: 'Rahul Store', phone: '9000000001' })
      .set(auth(adminA));

    expect(res.status).toBe(200);
    expect(res.body.data.matches[0].party.name).toBe('Rahul Store');
    expect(res.body.data.matches[0].reasons).toEqual(['phone', 'name']);
  });

  it('refuses a name that another customer already uses, even when duplicates are allowed', async () => {
    const res = await createParty(adminA, {
      name: 'Rahul Store',
      relationship: 'CUSTOMER',
      allowDuplicate: true,
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CUSTOMER_NAME_TAKEN');
  });
});

describe('the old /customers and /suppliers endpoints', () => {
  it('still create a customer, now with its own party', async () => {
    const res = await request(app)
      .post('/api/v1/customers')
      .set(auth(adminA))
      .send({ name: 'Legacy Customer', phone: '9111111111' });

    expect(res.status).toBe(201);
    expect(res.body.data.customer.name).toBe('Legacy Customer');
    const party = await getParty(adminA, res.body.data.customer.partyId);
    expect(party.body.data.party).toMatchObject({ relationship: 'CUSTOMER', phone: '9111111111' });
  });

  it('still create a supplier, now with its own party', async () => {
    const res = await request(app)
      .post('/api/v1/suppliers')
      .set(auth(adminA))
      .send({ name: 'Legacy Supplier' });

    expect(res.status).toBe(201);
    const party = await getParty(adminA, res.body.data.supplier.partyId);
    expect(party.body.data.party.relationship).toBe('SUPPLIER');
  });

  it('keep a both-party in step when one side is edited the old way', async () => {
    const both = await prisma.party.findFirst({
      where: { companyId: companyA.company.id, name: 'XYZ Traders' },
      include: { customer: true, supplier: true },
    });

    const res = await request(app)
      .patch(`/api/v1/customers/${both.customer.id}`)
      .set(auth(adminA))
      .send({ phone: '9000000033', creditLimit: '50000' });

    expect(res.status).toBe(200);
    expect(res.body.data.customer.phone).toBe('9000000033');
    expect(res.body.data.customer.creditLimit).toBe('50000.00');

    const supplier = await prisma.supplier.findUnique({ where: { id: both.supplier.id } });
    const party = await prisma.party.findUnique({ where: { id: both.id } });
    expect(supplier.phone).toBe('9000000033');
    expect(party.phone).toBe('9000000033');
    // Credit limit belongs to one side only.
    expect(supplier.creditLimit.toString()).toBe('0');
  });
});

describe('a party that is both a customer and a supplier', () => {
  let both;
  let purchase;
  let sale;

  beforeAll(async () => {
    const found = await prisma.party.findFirst({
      where: { companyId: companyA.company.id, name: 'XYZ Traders' },
      include: { customer: true, supplier: true },
    });
    both = { id: found.id, customerId: found.customer.id, supplierId: found.supplier.id };

    // We buy from XYZ for 20,000 and sell to them for 8,000.
    purchase = await postPurchase(adminA, both.supplierId, '20000');
    sale = await postSale(adminA, both.customerId, '8000');
  });

  it('is usable in purchases through its supplier id and in sales through its customer id', () => {
    expect(purchase.supplier.id).toBe(both.supplierId);
    expect(sale.customer?.id ?? sale.customerId).toBe(both.customerId);
  });

  it('keeps the receivable and the payable apart - no net figure', async () => {
    const res = await getParty(adminA, both.id);

    expect(res.status).toBe(200);
    expect(res.body.data.party.customer.receivable).toBe('8000.00');
    expect(res.body.data.party.supplier.payable).toBe('20000.00');
    expect(res.body.data.party).not.toHaveProperty('net');
    expect(res.body.data.party).not.toHaveProperty('balance');
  });

  it('shows both balances, separately, in the list', async () => {
    const res = await request(app)
      .get('/api/v1/parties')
      .query({ relationship: 'BOTH', search: 'XYZ' })
      .set(auth(adminA));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      receivable: '8000.00',
      payable: '20000.00',
      lastTransactionDate: '2026-09-02',
    });
  });

  it('reports overdue on each side on its own', async () => {
    const res = await getParty(adminA, both.id);
    // Due dates 2026-09-10 and 2026-09-12 have passed by the time these run.
    expect(res.body.data.party.customer.overdue).toBe('8000.00');
    expect(res.body.data.party.supplier.overdue).toBe('20000.00');
  });

  it('has a customer ledger with only sales and a supplier ledger with only purchases', async () => {
    const customerLedger = await request(app)
      .get(`/api/v1/parties/${both.id}/customer-ledger`)
      .set(auth(adminA));
    const supplierLedger = await request(app)
      .get(`/api/v1/parties/${both.id}/supplier-ledger`)
      .set(auth(adminA));

    expect(customerLedger.status).toBe(200);
    expect(supplierLedger.status).toBe(200);
    const customerEntries = await prisma.customerLedgerEntry.findMany({ where: { customerId: both.customerId } });
    const supplierEntries = await prisma.supplierLedgerEntry.findMany({ where: { supplierId: both.supplierId } });
    expect(customerEntries.map((e) => e.entryType)).toEqual(['SALE']);
    expect(supplierEntries.map((e) => e.entryType)).toEqual(['PURCHASE']);
  });

  it('a receipt from the customer lowers the receivable and leaves the payable alone', async () => {
    const receivable = await prisma.customerReceivable.findFirst({ where: { customerId: both.customerId } });
    const created = await request(app)
      .post('/api/v1/customer-payments')
      .set(auth(adminA))
      .send({
        customerId: both.customerId,
        paymentDate: '2026-09-03',
        amount: '3000',
        paymentMethod: 'CASH',
        allocations: [{ receivableId: receivable.id, amount: '3000' }],
      });
    expect(created.status).toBe(201);
    const posted = await request(app)
      .post(`/api/v1/customer-payments/${created.body.data.payment.id}/post`)
      .set(auth(adminA));
    expect(posted.status).toBe(200);

    const party = (await getParty(adminA, both.id)).body.data.party;
    expect(party.customer.receivable).toBe('5000.00');
    expect(party.supplier.payable).toBe('20000.00');
  });

  it('a payment to the supplier lowers the payable and leaves the receivable alone', async () => {
    const payable = await prisma.supplierPayable.findFirst({ where: { supplierId: both.supplierId } });
    const created = await request(app)
      .post('/api/v1/supplier-payments')
      .set(auth(adminA))
      .send({
        supplierId: both.supplierId,
        paymentDate: '2026-09-03',
        amount: '5000',
        paymentMethod: 'CASH',
        allocations: [{ payableId: payable.id, amount: '5000' }],
      });
    expect(created.status).toBe(201);
    const posted = await request(app)
      .post(`/api/v1/supplier-payments/${created.body.data.payment.id}/post`)
      .set(auth(adminA));
    expect(posted.status).toBe(200);

    const party = (await getParty(adminA, both.id)).body.data.party;
    expect(party.customer.receivable).toBe('5000.00');
    expect(party.supplier.payable).toBe('15000.00');
  });

  it('cannot allocate a customer receipt against the same party\'s supplier bill', async () => {
    const payable = await prisma.supplierPayable.findFirst({ where: { supplierId: both.supplierId } });
    const res = await request(app)
      .post('/api/v1/customer-payments')
      .set(auth(adminA))
      .send({
        customerId: both.customerId,
        paymentDate: '2026-09-04',
        amount: '100',
        paymentMethod: 'CASH',
        allocations: [{ receivableId: payable.id, amount: '100' }],
      });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('keeps the dashboard receivable and payable separate, and counts parties', async () => {
    const res = await request(app).get('/api/v1/dashboard').set(auth(adminA));
    expect(res.status).toBe(200);
    expect(res.body.data.dashboard.balances.customerReceivables.total).toBe('5000.00');
    expect(res.body.data.dashboard.balances.supplierPayables.total).toBe('15000.00');
    expect(res.body.data.dashboard.parties.both).toBeGreaterThanOrEqual(1);
    expect(res.body.data.dashboard.parties.customers).toBeGreaterThanOrEqual(res.body.data.dashboard.parties.both);
  });

  it('returns both statements, one per side', async () => {
    const res = await request(app).get(`/api/v1/parties/${both.id}/statement`).set(auth(adminA));
    expect(res.status).toBe(200);
    expect(res.body.data.customer).not.toBeNull();
    expect(res.body.data.supplier).not.toBeNull();
  });

  it('renaming the party changes no posted document and no journal entry', async () => {
    const [invoiceBefore, journalsBefore, linesBefore] = await Promise.all([
      prisma.salesInvoice.findUnique({ where: { id: sale.id } }),
      prisma.journalEntry.count({ where: { companyId: companyA.company.id } }),
      prisma.journalLine.findMany({ where: { journalEntry: { companyId: companyA.company.id } }, orderBy: { id: 'asc' } }),
    ]);

    const res = await request(app)
      .patch(`/api/v1/parties/${both.id}`)
      .set(auth(adminA))
      .send({ name: 'XYZ Traders Pvt Ltd' });
    expect(res.status).toBe(200);

    const [invoiceAfter, journalsAfter, linesAfter] = await Promise.all([
      prisma.salesInvoice.findUnique({ where: { id: sale.id } }),
      prisma.journalEntry.count({ where: { companyId: companyA.company.id } }),
      prisma.journalLine.findMany({ where: { journalEntry: { companyId: companyA.company.id } }, orderBy: { id: 'asc' } }),
    ]);
    expect(invoiceAfter).toEqual(invoiceBefore);
    expect(journalsAfter).toBe(journalsBefore);
    expect(linesAfter).toEqual(linesBefore);

    // And both sides carry the new name.
    const [customer, supplier] = await Promise.all([
      prisma.customer.findUnique({ where: { id: both.customerId } }),
      prisma.supplier.findUnique({ where: { id: both.supplierId } }),
    ]);
    expect(customer.name).toBe('XYZ Traders Pvt Ltd');
    expect(supplier.name).toBe('XYZ Traders Pvt Ltd');
  });

  it('concurrent edits leave the party and both sides with one consistent name', async () => {
    const names = ['XYZ One', 'XYZ Two', 'XYZ Three', 'XYZ Four'];
    const results = await Promise.all(
      names.map((name) =>
        request(app).patch(`/api/v1/parties/${both.id}`).set(auth(adminA)).send({ name, phone: '9000000099' }),
      ),
    );
    results.forEach((r) => expect(r.status).toBe(200));

    const party = await prisma.party.findUnique({
      where: { id: both.id },
      include: { customer: true, supplier: true },
    });
    expect(names).toContain(party.name);
    expect(party.customer.name).toBe(party.name);
    expect(party.supplier.name).toBe(party.name);
  });
});

describe('adding a side and linking records', () => {
  it('turns a customer-only party into both, without touching its history', async () => {
    const created = await createParty(adminA, { name: 'Grows Into Both', relationship: 'CUSTOMER' });
    const id = created.body.data.party.id;

    const res = await request(app)
      .post(`/api/v1/parties/${id}/relationships`)
      .set(auth(adminA))
      .send({ role: 'SUPPLIER' });

    expect(res.status).toBe(200);
    expect(res.body.data.party.relationship).toBe('BOTH');

    // Idempotent.
    const again = await request(app)
      .post(`/api/v1/parties/${id}/relationships`)
      .set(auth(adminA))
      .send({ role: 'SUPPLIER' });
    expect(again.status).toBe(200);
    expect(await prisma.supplier.count({ where: { partyId: id } })).toBe(1);
  });

  it('links an existing supplier record to a customer party, keeping the supplier id', async () => {
    const customerParty = (await createParty(adminA, { name: 'Same Biz', phone: '9222222222', relationship: 'CUSTOMER' }))
      .body.data.party;
    const supplier = await request(app)
      .post('/api/v1/suppliers')
      .set(auth(adminA))
      .send({ name: 'Same Biz (purchases)', gstin: '19ABCDE1234F2Z4' });
    const supplierId = supplier.body.data.supplier.id;
    const oldPartyId = supplier.body.data.supplier.partyId;

    const res = await request(app)
      .post(`/api/v1/parties/${customerParty.id}/link`)
      .set(auth(adminA))
      .send({ supplierId });

    expect(res.status).toBe(200);
    expect(res.body.data.party).toMatchObject({ relationship: 'BOTH', supplierId });
    // The GSTIN the supplier record had fills the gap on the party.
    expect(res.body.data.party.gstin).toBe('19ABCDE1234F2Z4');
    expect(await prisma.party.findUnique({ where: { id: oldPartyId } })).toBeNull();
  });

  it('refuses to split a both-party by linking one of its sides elsewhere', async () => {
    const target = (await createParty(adminA, { name: 'Link Target', relationship: 'CUSTOMER' })).body.data.party;
    const bothParty = await prisma.party.findFirst({
      where: { companyId: companyA.company.id, name: 'Local Kirana' },
      include: { supplier: true },
    });

    const res = await request(app)
      .post(`/api/v1/parties/${target.id}/link`)
      .set(auth(adminA))
      .send({ supplierId: bothParty.supplier.id });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PARTY_LINK_CONFLICT');
  });
});

describe('bill import', () => {
  it('finds a customer-only party on a purchase bill and offers it, without choosing it', async () => {
    const bill = await createReviewBill(
      companyA.company.id,
      companyA.admin.id,
      { partyName: 'Rahul Store', partyPhone: null, lines: [] },
      'IN',
    );

    const res = await request(app).get(`/api/v1/bills/${bill.id}/suggestions`).set(auth(adminA));

    expect(res.status).toBe(200);
    // No supplier is called Rahul Store, so nothing is pre-selected...
    expect(res.body.data.party).toBeNull();
    // ...but the party is offered, marked as not yet a supplier.
    expect(res.body.data.possibleParties[0]).toMatchObject({
      name: 'Rahul Store',
      relationship: 'CUSTOMER',
      hasRole: false,
      roleId: null,
    });
  });

  it('confirming an IN bill against that party makes it a supplier and posts to its supplier side', async () => {
    const rahul = await prisma.party.findFirst({ where: { companyId: companyA.company.id, name: 'Rahul Store' } });
    const bill = await createReviewBill(companyA.company.id, companyA.admin.id, { partyName: 'Rahul Store', lines: [] }, 'IN');

    const res = await request(app)
      .post(`/api/v1/bills/${bill.id}/confirm`)
      .set(auth(adminA))
      .send({
        document: {
          warehouseId: ctx.warehouseId,
          invoiceNumber: 'OCR-IN-1',
          invoiceDate: '2026-09-05',
          items: [{ productId: ctx.productId, quantity: '1', unitCost: '100' }],
        },
        newParty: { name: 'Rahul Store', partyId: rahul.id },
      });

    expect(res.status).toBe(201);
    const purchase = await prisma.purchase.findUnique({ where: { id: res.body.data.bill.posted.sourceId } });
    const supplier = await prisma.supplier.findUnique({ where: { id: purchase.supplierId } });
    expect(supplier.partyId).toBe(rahul.id);
    // Still one party, now both.
    expect((await getParty(adminA, rahul.id)).body.data.party.relationship).toBe('BOTH');
  });

  it('confirming an OUT bill against a supplier-only party makes it a customer', async () => {
    const abc = await prisma.party.findFirst({ where: { companyId: companyA.company.id, name: 'ABC Distributor' } });
    const bill = await createReviewBill(companyA.company.id, companyA.admin.id, { partyName: 'ABC Distributor', lines: [] }, 'OUT');

    const suggestions = await request(app).get(`/api/v1/bills/${bill.id}/suggestions`).set(auth(adminA));
    expect(suggestions.body.data.possibleParties[0]).toMatchObject({ partyId: abc.id, hasRole: false });

    const res = await request(app)
      .post(`/api/v1/bills/${bill.id}/confirm`)
      .set(auth(adminA))
      .send({
        document: {
          warehouseId: ctx.warehouseId,
          invoiceDate: '2026-09-05',
          items: [{ productId: ctx.productId, quantity: '1', unitPrice: '150' }],
        },
        newParty: { name: 'ABC Distributor', partyId: abc.id },
      });

    expect(res.status).toBe(201);
    const invoice = await prisma.salesInvoice.findUnique({ where: { id: res.body.data.bill.posted.sourceId } });
    const customer = await prisma.customer.findUnique({ where: { id: invoice.customerId } });
    expect(customer.partyId).toBe(abc.id);
  });

  it('an ambiguous name is offered as several candidates and nothing is pre-selected', async () => {
    await createParty(adminA, { name: 'Gupta Brothers', relationship: 'SUPPLIER' });
    await createParty(adminA, { name: 'Gupta Brothers Wholesale', relationship: 'SUPPLIER' });
    const bill = await createReviewBill(companyA.company.id, companyA.admin.id, { partyName: 'Gupta Bro', lines: [] }, 'IN');

    const res = await request(app).get(`/api/v1/bills/${bill.id}/suggestions`).set(auth(adminA));
    expect(res.body.data.party).toBeNull();
    expect(res.body.data.possibleParties.length).toBeGreaterThanOrEqual(2);

    // And the bill cannot be recorded until a person picks one.
    const confirm = await request(app)
      .post(`/api/v1/bills/${bill.id}/confirm`)
      .set(auth(adminA))
      .send({
        document: {
          warehouseId: ctx.warehouseId,
          invoiceNumber: 'OCR-AMB',
          invoiceDate: '2026-09-05',
          items: [{ productId: ctx.productId, quantity: '1', unitCost: '10' }],
        },
      });
    expect(confirm.status).toBe(400);
    expect(await prisma.purchase.count({ where: { invoiceNumber: 'OCR-AMB' } })).toBe(0);
  });

  it('marks a similar-name supplier match as not confident', async () => {
    const bill = await createReviewBill(
      companyA.company.id,
      companyA.admin.id,
      { partyName: 'Gupta Brothers Wholesale Kolkata', lines: [] },
      'IN',
    );
    const res = await request(app).get(`/api/v1/bills/${bill.id}/suggestions`).set(auth(adminA));
    if (res.body.data.party) expect(res.body.data.party.confident).toBe(false);
  });

  it('refuses another company\'s party on a bill', async () => {
    const foreign = (await createParty(adminB, { name: 'Foreign Party', relationship: 'CUSTOMER' })).body.data.party;
    const bill = await createReviewBill(companyA.company.id, companyA.admin.id, { partyName: 'Foreign Party', lines: [] }, 'IN');

    const res = await request(app)
      .post(`/api/v1/bills/${bill.id}/confirm`)
      .set(auth(adminA))
      .send({
        document: {
          warehouseId: ctx.warehouseId,
          invoiceNumber: 'OCR-FOREIGN',
          invoiceDate: '2026-09-05',
          items: [{ productId: ctx.productId, quantity: '1', unitCost: '10' }],
        },
        newParty: { name: 'Foreign Party', partyId: foreign.id },
      });
    expect(res.status).toBe(404);
    expect(await prisma.supplier.count({ where: { partyId: foreign.id } })).toBe(0);
  });
});

describe('tenant isolation', () => {
  it('never shows, returns or changes another company\'s party', async () => {
    const mine = (await createParty(adminA, { name: 'Private To A', relationship: 'CUSTOMER' })).body.data.party;

    const [get, patch, status, ledger, list, link] = await Promise.all([
      getParty(adminB, mine.id),
      request(app).patch(`/api/v1/parties/${mine.id}`).set(auth(adminB)).send({ name: 'Hijacked' }),
      request(app).patch(`/api/v1/parties/${mine.id}/status`).set(auth(adminB)).send({ isActive: false }),
      request(app).get(`/api/v1/parties/${mine.id}/customer-ledger`).set(auth(adminB)),
      request(app).get('/api/v1/parties').query({ search: 'Private To A' }).set(auth(adminB)),
      request(app).post(`/api/v1/parties/${mine.id}/relationships`).set(auth(adminB)).send({ role: 'SUPPLIER' }),
    ]);

    expect(get.status).toBe(404);
    expect(patch.status).toBe(404);
    expect(status.status).toBe(404);
    expect(ledger.status).toBe(404);
    expect(link.status).toBe(404);
    expect(list.body.data).toHaveLength(0);
    expect((await prisma.party.findUnique({ where: { id: mine.id } })).name).toBe('Private To A');
  });

  it('cannot link another company\'s customer into a party', async () => {
    const target = (await createParty(adminA, { name: 'Link Victim', relationship: 'SUPPLIER' })).body.data.party;
    const foreign = await request(app).post('/api/v1/customers').set(auth(adminB)).send({ name: 'B Customer' });

    const res = await request(app)
      .post(`/api/v1/parties/${target.id}/link`)
      .set(auth(adminA))
      .send({ customerId: foreign.body.data.customer.id });
    expect(res.status).toBe(404);
  });

  it('ignores a companyId sent in the body', async () => {
    const res = await createParty(adminA, { name: 'Sneaky', relationship: 'CUSTOMER', companyId: 'x' });
    expect(res.status).toBe(400);
  });
});

describe('who may do what', () => {
  it('lets STAFF read parties but not create, edit or link them', async () => {
    const list = await request(app).get('/api/v1/parties').set(auth(staffA));
    expect(list.status).toBe(200);

    const any = list.body.data[0];
    const [create, patch, status, add] = await Promise.all([
      createParty(staffA, { name: 'Staff Made', relationship: 'CUSTOMER' }),
      request(app).patch(`/api/v1/parties/${any.id}`).set(auth(staffA)).send({ name: 'Staff Edit' }),
      request(app).patch(`/api/v1/parties/${any.id}/status`).set(auth(staffA)).send({ isActive: false }),
      request(app).post(`/api/v1/parties/${any.id}/relationships`).set(auth(staffA)).send({ role: 'SUPPLIER' }),
    ]);
    expect([create.status, patch.status, status.status, add.status]).toEqual([403, 403, 403, 403]);
  });

  it('keeps platform users (who belong to no shop) out entirely', async () => {
    const res = await request(app).get('/api/v1/parties').set(auth(platformToken));
    expect(res.status).toBe(403);
  });

  it('refuses anonymous requests', async () => {
    const res = await request(app).get('/api/v1/parties');
    expect(res.status).toBe(401);
  });
});

describe('list filters and summary', () => {
  it('filters by relationship and searches by phone and GSTIN', async () => {
    const [suppliers, byPhone, byGstin, summary] = await Promise.all([
      request(app).get('/api/v1/parties').query({ relationship: 'SUPPLIER', limit: 100 }).set(auth(adminA)),
      request(app).get('/api/v1/parties').query({ search: '9111111111' }).set(auth(adminA)),
      request(app).get('/api/v1/parties').query({ search: '19ABCDE1234F1Z5' }).set(auth(adminA)),
      request(app).get('/api/v1/parties/summary').set(auth(adminA)),
    ]);

    expect(suppliers.body.data.every((p) => p.isSupplier)).toBe(true);
    expect(byPhone.body.data.map((p) => p.name)).toEqual(['Legacy Customer']);
    expect(byGstin.body.data.map((p) => p.name)).toEqual(['Gst Wholesale']);
    expect(summary.body.data.counts.total).toBeGreaterThanOrEqual(summary.body.data.counts.customers);
  });

  it('switching a party off hides both sides from pickers but keeps its history', async () => {
    const party = await prisma.party.findFirst({
      where: { companyId: companyA.company.id, name: 'Local Kirana' },
      include: { customer: true, supplier: true },
    });
    const res = await request(app)
      .patch(`/api/v1/parties/${party.id}/status`)
      .set(auth(adminA))
      .send({ isActive: false });

    expect(res.status).toBe(200);
    const [customer, supplier] = await Promise.all([
      prisma.customer.findUnique({ where: { id: party.customer.id } }),
      prisma.supplier.findUnique({ where: { id: party.supplier.id } }),
    ]);
    expect(customer.isActive).toBe(false);
    expect(supplier.isActive).toBe(false);
  });
});
