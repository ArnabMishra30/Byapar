import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma, resetDatabase, createCompanyWithUsers, login } from '../helpers/db.js';

// MATCHING A BILL TO THE SHOP'S OWN RECORDS, and adding what is missing.
//
// Two jobs, both covered here:
//
//   SUGGESTIONS  a read-only opinion about which supplier and which products a
//                bill refers to. It must be confident or silent - a wrong
//                supplier books a purchase into the wrong ledger, and a wrong
//                product moves the wrong stock.
//
//   CREATION     confirming a bill may add the supplier and products it names,
//                through the ordinary services, before posting through the
//                ordinary purchase flow.
//
// And the rule that outranks both: one shop can never see or touch another's.

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const PASSWORD = 'test-password-123';

let companyA;
let tokenA;
let tokenB;
let ctxA;

/** The master data a shop already has before any bill arrives. */
async function prepareCompany(token, suffix) {
  const category = await request(app)
    .post('/api/v1/categories')
    .set(auth(token))
    .send({ name: `Grocery ${suffix}` });

  const unit = await request(app)
    .post('/api/v1/units')
    .set(auth(token))
    .send({ name: `Kilogram ${suffix}`, shortCode: `KG${suffix}` });

  const product = await request(app)
    .post('/api/v1/products')
    .set(auth(token))
    .send({
      name: 'Basmati Rice 5kg',
      categoryId: category.body.data.category.id,
      unitId: unit.body.data.unit.id,
      sku: `RICE-${suffix}`,
    });

  const supplier = await request(app)
    .post('/api/v1/suppliers')
    .set(auth(token))
    .send({
      name: 'Sharma General Store',
      gstin: '19ABCDE1234F1Z5',
      phone: '9876543210',
    });

  const warehouse = await request(app)
    .post('/api/v1/warehouses')
    .set(auth(token))
    .send({ name: `Main ${suffix}`, code: `MN${suffix}` });

  return {
    categoryId: category.body.data.category.id,
    unitId: unit.body.data.unit.id,
    productId: product.body.data.product.id,
    supplierId: supplier.body.data.supplier.id,
    warehouseId: warehouse.body.data.warehouse.id,
  };
}

/** A bill already read and waiting for review, without needing a vendor key. */
function createReviewBill(companyId, uploadedById, reviewedData, direction = 'IN') {
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

  companyA = await createCompanyWithUsers('matcha');
  const companyB = await createCompanyWithUsers('matchb');

  tokenA = await login(app, companyA.admin.email, PASSWORD);
  tokenB = await login(app, companyB.admin.email, PASSWORD);

  ctxA = await prepareCompany(tokenA, 'A');
});

describe('GET /api/v1/bills/:id/suggestions', () => {
  it('finds the supplier and the product a bill names', async () => {
    const bill = await createReviewBill(companyA.company.id, companyA.admin.id, {
      partyName: 'Sharma General Store',
      lines: [{ description: 'Basmati Rice 5kg', quantity: '2', unitPrice: '420.00' }],
    });

    const response = await request(app)
      .get(`/api/v1/bills/${bill.id}/suggestions`)
      .set(auth(tokenA));

    expect(response.status).toBe(200);
    expect(response.body.data.party).toMatchObject({ id: ctxA.supplierId, matchedBy: 'name' });
    expect(response.body.data.lines[0]).toMatchObject({
      index: 0,
      productId: ctxA.productId,
      matchedBy: 'name',
    });
  });

  it('matches a supplier by GSTIN even when the printed name differs', async () => {
    const bill = await createReviewBill(companyA.company.id, companyA.admin.id, {
      partyName: 'SHARMA GEN. STORES (UNIT 2)',
      partyGstin: '19ABCDE1234F1Z5',
      lines: [],
    });

    const response = await request(app)
      .get(`/api/v1/bills/${bill.id}/suggestions`)
      .set(auth(tokenA));

    expect(response.status).toBe(200);
    expect(response.body.data.party).toMatchObject({ id: ctxA.supplierId, matchedBy: 'gstin' });
  });

  it('stays silent about a line it does not recognise rather than guessing', async () => {
    const bill = await createReviewBill(companyA.company.id, companyA.admin.id, {
      partyName: 'Someone Not In The Records',
      lines: [{ description: 'Imported Olive Oil 2L', quantity: '1' }],
    });

    const response = await request(app)
      .get(`/api/v1/bills/${bill.id}/suggestions`)
      .set(auth(tokenA));

    expect(response.status).toBe(200);
    expect(response.body.data.party).toBeNull();
    expect(response.body.data.lines[0].productId).toBeNull();
  });

  it('never matches against another shop, and hides the bill entirely', async () => {
    const bill = await createReviewBill(companyA.company.id, companyA.admin.id, {
      partyName: 'Sharma General Store',
      lines: [{ description: 'Basmati Rice 5kg' }],
    });

    const response = await request(app)
      .get(`/api/v1/bills/${bill.id}/suggestions`)
      .set(auth(tokenB));

    expect(response.status).toBe(404);
  });
});

describe('POST /api/v1/bills/:id/confirm with records that do not exist yet', () => {
  it('creates the supplier and product the bill names, then posts the purchase', async () => {
    const bill = await createReviewBill(companyA.company.id, companyA.admin.id, {
      partyName: 'Verma Wholesale',
      lines: [{ description: 'Mustard Oil 1L', quantity: '3', unitPrice: '165.00' }],
    });

    const response = await request(app)
      .post(`/api/v1/bills/${bill.id}/confirm`)
      .set(auth(tokenA))
      .send({
        document: {
          warehouseId: ctxA.warehouseId,
          invoiceNumber: 'INV-NEW-1',
          invoiceDate: '2026-06-15',
          // No supplierId and no productId: both are about to be created.
          items: [{ quantity: '3', unitCost: '165' }],
        },
        newParty: { name: 'Verma Wholesale', phone: '9812345678' },
        newProducts: [{ index: 0, name: 'Mustard Oil 1L', unit: 'L', price: '165' }],
      });

    expect(response.status).toBe(201);
    expect(response.body.data.bill.status).toBe('POSTED');

    const supplier = await prisma.supplier.findFirst({
      where: { companyId: companyA.company.id, name: 'Verma Wholesale' },
    });
    expect(supplier).not.toBeNull();
    expect(supplier.phone).toBe('9812345678');

    const product = await prisma.product.findFirst({
      where: { companyId: companyA.company.id, name: 'Mustard Oil 1L' },
    });
    expect(product).not.toBeNull();
    // A product needs a category and a unit; a bill line has neither, so the
    // service fills them in rather than refusing.
    expect(product.categoryId).toBeTruthy();
    expect(product.unitId).toBeTruthy();

    // The purchase is a real one, posted through the ordinary flow.
    const purchase = await prisma.purchase.findUnique({
      where: { id: response.body.data.bill.posted.sourceId },
      include: { items: true },
    });
    expect(purchase.status).toBe('POSTED');
    expect(purchase.supplierId).toBe(supplier.id);
    expect(purchase.items[0].productId).toBe(product.id);

    // And the second bill from the same supplier now matches it, with nothing
    // new to create.
    const second = await createReviewBill(companyA.company.id, companyA.admin.id, {
      partyName: 'Verma Wholesale',
      lines: [{ description: 'Mustard Oil 1L' }],
    });

    const suggestions = await request(app)
      .get(`/api/v1/bills/${second.id}/suggestions`)
      .set(auth(tokenA));

    expect(suggestions.body.data.party.id).toBe(supplier.id);
    expect(suggestions.body.data.lines[0].productId).toBe(product.id);
  });

  it('does not ask which store when the shop has exactly one', async () => {
    const bill = await createReviewBill(companyA.company.id, companyA.admin.id, {
      partyName: 'Sharma General Store',
      lines: [{ description: 'Basmati Rice 5kg', quantity: '1', unitPrice: '420' }],
    });

    const response = await request(app)
      .post(`/api/v1/bills/${bill.id}/confirm`)
      .set(auth(tokenA))
      .send({
        document: {
          // No warehouseId at all: there is only one, so there is nothing to ask.
          supplierId: ctxA.supplierId,
          invoiceNumber: 'INV-NOWH-1',
          invoiceDate: '2026-06-15',
          items: [{ productId: ctxA.productId, quantity: '1', unitCost: '420' }],
        },
      });

    expect(response.status).toBe(201);

    const purchase = await prisma.purchase.findUnique({
      where: { id: response.body.data.bill.posted.sourceId },
    });
    expect(purchase.warehouseId).toBe(ctxA.warehouseId);
  });

  it('creates the first store for a shop that has none', async () => {
    const company = await createCompanyWithUsers('matchc');
    const token = await login(app, company.admin.email, PASSWORD);

    const category = await request(app)
      .post('/api/v1/categories')
      .set(auth(token))
      .send({ name: 'General C' });
    await request(app)
      .post('/api/v1/units')
      .set(auth(token))
      .send({ name: 'Piece C', shortCode: 'PCSC' });

    expect(await prisma.warehouse.count({ where: { companyId: company.company.id } })).toBe(0);

    const bill = await createReviewBill(company.company.id, company.admin.id, {
      partyName: 'First Supplier',
      lines: [{ description: 'Sugar 1kg', quantity: '2', unitPrice: '45' }],
    });

    const response = await request(app)
      .post(`/api/v1/bills/${bill.id}/confirm`)
      .set(auth(token))
      .send({
        document: {
          invoiceNumber: 'INV-FIRST-1',
          invoiceDate: '2026-06-15',
          items: [{ quantity: '2', unitCost: '45' }],
        },
        newParty: { name: 'First Supplier' },
        newProducts: [{ index: 0, name: 'Sugar 1kg', unit: 'kg', price: '45' }],
        newWarehouse: { name: 'Main Store' },
      });

    expect(response.status).toBe(201);
    expect(category.status).toBe(201);

    const warehouses = await prisma.warehouse.findMany({
      where: { companyId: company.company.id },
    });
    expect(warehouses).toHaveLength(1);
    expect(warehouses[0].name).toBe('Main Store');

    const purchase = await prisma.purchase.findUnique({
      where: { id: response.body.data.bill.posted.sourceId },
    });
    expect(purchase.warehouseId).toBe(warehouses[0].id);
  });

  it('refuses a document that is still incomplete, and creates nothing', async () => {
    const bill = await createReviewBill(companyA.company.id, companyA.admin.id, {
      partyName: 'Ghost Traders',
      lines: [{ description: 'Nothing' }],
    });

    const response = await request(app)
      .post(`/api/v1/bills/${bill.id}/confirm`)
      .set(auth(tokenA))
      .send({
        document: {
          warehouseId: ctxA.warehouseId,
          invoiceNumber: 'INV-BAD-1',
          invoiceDate: '2026-06-15',
          items: [], // no lines at all
        },
        newParty: { name: 'Ghost Traders' },
      });

    expect(response.status).toBe(400);

    const stillUnposted = await prisma.bill.findUnique({ where: { id: bill.id } });
    expect(stillUnposted.status).not.toBe('POSTED');
  });

  it('uses records an earlier attempt already created instead of refusing', async () => {
    // Exactly the state a failed posting leaves behind: the supplier and the
    // product exist, and the shop presses Record again.
    await request(app)
      .post('/api/v1/suppliers')
      .set(auth(tokenA))
      .send({ name: 'Retry Traders' });
    await request(app)
      .post('/api/v1/products')
      .set(auth(tokenA))
      .send({ name: 'Retry Sugar 1kg', categoryId: ctxA.categoryId, unitId: ctxA.unitId });

    const bill = await createReviewBill(companyA.company.id, companyA.admin.id, {
      partyName: 'Retry Traders',
      lines: [{ description: 'Retry Sugar 1kg', quantity: '1', unitPrice: '50' }],
    });

    const response = await request(app)
      .post(`/api/v1/bills/${bill.id}/confirm`)
      .set(auth(tokenA))
      .send({
        document: {
          warehouseId: ctxA.warehouseId,
          invoiceNumber: 'INV-RETRY-1',
          invoiceDate: '2026-06-15',
          items: [{ quantity: '1', unitCost: '50' }],
        },
        newParty: { name: 'Retry Traders' },
        newProducts: [{ index: 0, name: 'Retry Sugar 1kg' }],
      });

    expect(response.status).toBe(201);

    // One of each, not two: the existing records were used.
    expect(
      await prisma.supplier.count({
        where: { companyId: companyA.company.id, name: 'Retry Traders' },
      }),
    ).toBe(1);
    expect(
      await prisma.product.count({
        where: { companyId: companyA.company.id, name: 'Retry Sugar 1kg' },
      }),
    ).toBe(1);
  });

  it('finishes the draft a failed attempt left behind rather than starting another', async () => {
    const bill = await createReviewBill(companyA.company.id, companyA.admin.id, {
      partyName: 'Sharma General Store',
      lines: [{ description: 'Basmati Rice 5kg', quantity: '1', unitPrice: '420' }],
    });

    const document = {
      warehouseId: ctxA.warehouseId,
      supplierId: ctxA.supplierId,
      invoiceNumber: 'INV-RESUME-1',
      invoiceDate: '2026-06-15',
      items: [{ productId: ctxA.productId, quantity: '1', unitCost: '420' }],
    };

    // The draft an interrupted confirm would have created and recorded.
    const draft = await request(app)
      .post('/api/v1/purchases')
      .set(auth(tokenA))
      .send(document);
    expect(draft.status).toBe(201);

    const draftId = draft.body.data.purchase.id;
    await prisma.bill.update({
      where: { id: bill.id },
      data: { postedSourceType: 'PURCHASE', postedSourceId: draftId },
    });

    const before = await prisma.purchase.count({ where: { companyId: companyA.company.id } });

    const response = await request(app)
      .post(`/api/v1/bills/${bill.id}/confirm`)
      .set(auth(tokenA))
      .send({ document });

    expect(response.status).toBe(201);
    // The same document, now posted - not a second one.
    expect(response.body.data.bill.posted.sourceId).toBe(draftId);
    expect(await prisma.purchase.count({ where: { companyId: companyA.company.id } })).toBe(before);

    const purchase = await prisma.purchase.findUnique({ where: { id: draftId } });
    expect(purchase.status).toBe('POSTED');
  });

  // Last, because it gives company A a second store and so changes the answer
  // to "which store?" for everything after it.
  it('asks which store once a shop has more than one', async () => {
    await request(app)
      .post('/api/v1/warehouses')
      .set(auth(tokenA))
      .send({ name: 'Back Godown A', code: 'BACKA' });

    const bill = await createReviewBill(companyA.company.id, companyA.admin.id, {
      partyName: 'Sharma General Store',
      lines: [{ description: 'Basmati Rice 5kg', quantity: '1', unitPrice: '420' }],
    });

    const response = await request(app)
      .post(`/api/v1/bills/${bill.id}/confirm`)
      .set(auth(tokenA))
      .send({
        document: {
          supplierId: ctxA.supplierId,
          invoiceNumber: 'INV-TWOWH-1',
          invoiceDate: '2026-06-15',
          items: [{ productId: ctxA.productId, quantity: '1', unitCost: '420' }],
        },
      });

    // Guessing between two godowns would put stock in the wrong place.
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toMatch(/warehouse/i);
  });
});
