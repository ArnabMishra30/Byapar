import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma, resetDatabase, createCompanyWithUsers, login } from '../helpers/db.js';

// STORAGE LOCATIONS: racks, shelves, drawers and fridges inside a warehouse.
//
// What these tests hold the feature to:
//   - each shop defines its own locations, per warehouse, and can start from a
//     one-tap starter layout without getting duplicates;
//   - a product names its usual spot, and every stock movement is tagged - with
//     the spot the person chose, or else the product's usual one;
//   - a location is a TAG: quantities and average cost are unchanged by it;
//   - a location from another warehouse or another company is refused.

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const PASSWORD = 'test-password-123';

let adminA;
let staffA;
let adminB;
let ctx;

async function prepare(token, suffix) {
  const [category, unit, main, godown] = await Promise.all([
    request(app).post('/api/v1/categories').set(auth(token)).send({ name: `LocCat ${suffix}` }),
    request(app).post('/api/v1/units').set(auth(token)).send({ name: `LocUnit ${suffix}`, shortCode: `LU${suffix}` }),
    request(app).post('/api/v1/warehouses').set(auth(token)).send({ name: `Shop ${suffix}`, code: `SH${suffix}` }),
    request(app).post('/api/v1/warehouses').set(auth(token)).send({ name: `Godown ${suffix}`, code: `GD${suffix}` }),
  ]);
  return {
    categoryId: category.body.data.category.id,
    unitId: unit.body.data.unit.id,
    mainId: main.body.data.warehouse.id,
    godownId: godown.body.data.warehouse.id,
  };
}

const createLocation = (token, body) =>
  request(app).post('/api/v1/storage-locations').set(auth(token)).send(body);

beforeAll(async () => {
  await resetDatabase();
  const companyA = await createCompanyWithUsers('loca');
  const companyB = await createCompanyWithUsers('locb');
  adminA = await login(app, companyA.admin.email, PASSWORD);
  staffA = await login(app, companyA.staff.email, PASSWORD);
  adminB = await login(app, companyB.admin.email, PASSWORD);
  ctx = await prepare(adminA, 'A');
});

describe('setting up locations', () => {
  it('creates a rack, a drawer and a fridge in a warehouse', async () => {
    const rack = await createLocation(adminA, { warehouseId: ctx.mainId, name: 'Rack A', type: 'RACK', code: 'ra' });
    const drawer = await createLocation(adminA, { warehouseId: ctx.mainId, name: 'Drawer 3', type: 'DRAWER' });
    const fridge = await createLocation(adminA, { warehouseId: ctx.mainId, name: 'Fridge', type: 'FRIDGE' });

    expect(rack.status).toBe(201);
    expect(rack.body.data.location).toMatchObject({ name: 'Rack A', type: 'RACK', code: 'RA', warehouseId: ctx.mainId });
    expect(drawer.status).toBe(201);
    expect(fridge.body.data.location.type).toBe('FRIDGE');
    ctx.rackId = rack.body.data.location.id;
    ctx.fridgeId = fridge.body.data.location.id;
  });

  it('refuses the same name twice in one warehouse, but allows it in another', async () => {
    const again = await createLocation(adminA, { warehouseId: ctx.mainId, name: 'rack a' });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('LOCATION_NAME_TAKEN');

    const elsewhere = await createLocation(adminA, { warehouseId: ctx.godownId, name: 'Rack A' });
    expect(elsewhere.status).toBe(201);
    ctx.godownRackId = elsewhere.body.data.location.id;
  });

  it('adds the starter layout once, without duplicates on a second tap', async () => {
    const first = await request(app).post('/api/v1/storage-locations/starter').set(auth(adminA)).send({ warehouseId: ctx.godownId });
    const second = await request(app).post('/api/v1/storage-locations/starter').set(auth(adminA)).send({ warehouseId: ctx.godownId });

    expect(first.status).toBe(201);
    const names = second.body.data.locations.map((l) => l.name);
    expect(names).toEqual(expect.arrayContaining(['Rack 1', 'Rack 2', 'Counter', 'Drawer 1', 'Fridge', 'Back store']));
    expect(new Set(names).size).toBe(names.length);
  });

  it('lists by warehouse and type', async () => {
    const res = await request(app)
      .get('/api/v1/storage-locations')
      .query({ warehouseId: ctx.mainId, type: 'FRIDGE' })
      .set(auth(staffA));
    expect(res.status).toBe(200);
    expect(res.body.data.map((l) => l.name)).toEqual(['Fridge']);
  });

  it('rejects an unknown type', async () => {
    const res = await createLocation(adminA, { warehouseId: ctx.mainId, name: 'Roof', type: 'ROOF' });
    expect(res.status).toBe(400);
  });
});

describe('products and stock movements carry the location', () => {
  let productId;

  it('a product remembers where it is usually kept', async () => {
    const res = await request(app).post('/api/v1/products').set(auth(adminA)).send({
      name: 'Paneer 200g',
      categoryId: ctx.categoryId,
      unitId: ctx.unitId,
      storageLocationId: ctx.fridgeId,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.product.storageLocation).toMatchObject({ name: 'Fridge', type: 'FRIDGE' });
    productId = res.body.data.product.id;
  });

  it('opening stock with no location chosen is tagged with the product\'s usual spot', async () => {
    const res = await request(app).post('/api/v1/inventory/opening-stock').set(auth(adminA)).send({
      productId,
      warehouseId: ctx.mainId,
      quantity: '10',
      unitCost: '80',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.movement.storageLocation).toMatchObject({ id: ctx.fridgeId, name: 'Fridge' });
  });

  it('an adjustment can name a different spot in the same warehouse', async () => {
    const res = await request(app).post('/api/v1/inventory/adjustments').set(auth(adminA)).send({
      productId,
      warehouseId: ctx.mainId,
      type: 'ADJUSTMENT_IN',
      quantity: '2',
      unitCost: '80',
      storageLocationId: ctx.rackId,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.movement.storageLocation.name).toBe('Rack A');
  });

  it('the product\'s spot is not used for a different warehouse', async () => {
    const res = await request(app).post('/api/v1/inventory/opening-stock').set(auth(adminA)).send({
      productId,
      warehouseId: ctx.godownId,
      quantity: '5',
      unitCost: '80',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.movement.storageLocation).toBeNull();
  });

  it('refuses a location from another warehouse', async () => {
    const res = await request(app).post('/api/v1/inventory/adjustments').set(auth(adminA)).send({
      productId,
      warehouseId: ctx.mainId,
      type: 'ADJUSTMENT_OUT',
      quantity: '1',
      storageLocationId: ctx.godownRackId,
    });
    expect(res.status).toBe(400);
  });

  it('is a tag only: quantity and average cost are per warehouse as before', async () => {
    const balance = await request(app).get(`/api/v1/inventory/${productId}/${ctx.mainId}`).set(auth(adminA));
    expect(balance.status).toBe(200);
    expect(balance.body.data.balance.quantity).toBe('12.000');
  });

  it('the stock ledger can be filtered by location', async () => {
    const res = await request(app)
      .get('/api/v1/inventory/movements')
      .query({ storageLocationId: ctx.rackId })
      .set(auth(adminA));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].type).toBe('ADJUSTMENT_IN');
  });

  it('switching a location off keeps the tag on past movements', async () => {
    const off = await request(app).patch(`/api/v1/storage-locations/${ctx.rackId}/status`).set(auth(adminA)).send({ isActive: false });
    expect(off.status).toBe(200);
    const movement = await prisma.stockMovement.findFirst({ where: { storageLocationId: ctx.rackId } });
    expect(movement).not.toBeNull();
  });
});

describe('a rack on each purchase / sale line, and from a bill', () => {
  let supplierId;
  let customerId;
  let productId;

  beforeAll(async () => {
    supplierId = (await request(app).post('/api/v1/suppliers').set(auth(adminA)).send({ name: 'Rack Supplier' })).body.data.supplier.id;
    customerId = (await request(app).post('/api/v1/customers').set(auth(adminA)).send({ name: 'Rack Customer' })).body.data.customer.id;
    productId = (
      await request(app).post('/api/v1/products').set(auth(adminA)).send({ name: 'Ghee 1L', categoryId: ctx.categoryId, unitId: ctx.unitId })
    ).body.data.product.id;
  });

  it('a purchase line with a rack tags its stock-in there', async () => {
    const created = await request(app).post('/api/v1/purchases').set(auth(adminA)).send({
      supplierId,
      warehouseId: ctx.mainId,
      invoiceNumber: 'RACK-1',
      invoiceDate: '2026-09-01',
      items: [{ productId, quantity: '5', unitCost: '500', storageLocationId: ctx.fridgeId }],
    });
    expect(created.status).toBe(201);
    expect(created.body.data.purchase.items[0].storageLocationId).toBe(ctx.fridgeId);

    const posted = await request(app).post(`/api/v1/purchases/${created.body.data.purchase.id}/post`).set(auth(adminA));
    expect(posted.status).toBe(200);
    const movement = await prisma.stockMovement.findFirst({ where: { productId, type: 'STOCK_IN' } });
    expect(movement.storageLocationId).toBe(ctx.fridgeId);
  });

  it('a sale line with a rack tags its stock-out there', async () => {
    const created = await request(app).post('/api/v1/sales').set(auth(adminA)).send({
      customerId,
      warehouseId: ctx.mainId,
      invoiceDate: '2026-09-02',
      items: [{ productId, quantity: '1', unitPrice: '700', storageLocationId: ctx.fridgeId }],
    });
    await request(app).post(`/api/v1/sales/${created.body.data.sale.id}/post`).set(auth(adminA));
    const movement = await prisma.stockMovement.findFirst({ where: { productId, type: 'STOCK_OUT' } });
    expect(movement.storageLocationId).toBe(ctx.fridgeId);
  });

  it('refuses a line rack from another warehouse', async () => {
    const res = await request(app).post('/api/v1/purchases').set(auth(adminA)).send({
      supplierId,
      warehouseId: ctx.mainId,
      invoiceNumber: 'RACK-BAD',
      invoiceDate: '2026-09-01',
      items: [{ productId, quantity: '1', unitCost: '1', storageLocationId: ctx.godownRackId }],
    });
    expect(res.status).toBe(400);
  });

  it('a bill line rack tags the stock and becomes the new product usual spot', async () => {
    const bill = await prisma.bill.create({
      data: {
        companyId: (await prisma.warehouse.findUnique({ where: { id: ctx.mainId } })).companyId,
        direction: 'IN',
        status: 'REVIEW',
        originalFilename: 'b.pdf',
        mimeType: 'application/pdf',
        fileSize: 10,
        storageKey: `rack/${Math.random().toString(36).slice(2)}.pdf`,
        reviewedData: { lines: [] },
        uploadedById: (await prisma.user.findFirst({ where: { email: 'admin@loca.test' } })).id,
      },
    });

    const res = await request(app).post(`/api/v1/bills/${bill.id}/confirm`).set(auth(adminA)).send({
      document: {
        supplierId,
        warehouseId: ctx.mainId,
        invoiceNumber: 'RACK-BILL',
        invoiceDate: '2026-09-05',
        items: [{ quantity: '3', unitCost: '40', storageLocationId: ctx.fridgeId }],
      },
      newProducts: [{ index: 0, name: 'Curd 400g', storageLocationId: ctx.fridgeId }],
    });

    expect(res.status).toBe(201);
    const product = await prisma.product.findFirst({ where: { name: 'Curd 400g' } });
    expect(product.storageLocationId).toBe(ctx.fridgeId);
    const movement = await prisma.stockMovement.findFirst({ where: { productId: product.id } });
    expect(movement.storageLocationId).toBe(ctx.fridgeId);
  });
});

describe('who may do what, and tenant isolation', () => {
  it('lets STAFF read locations but not create or change them', async () => {
    const create = await createLocation(staffA, { warehouseId: ctx.mainId, name: 'Staff Shelf' });
    const edit = await request(app).patch(`/api/v1/storage-locations/${ctx.fridgeId}`).set(auth(staffA)).send({ name: 'X' });
    expect([create.status, edit.status]).toEqual([403, 403]);
  });

  it('never shows or changes another company\'s location, nor accepts it on a product', async () => {
    const [get, patch, list] = await Promise.all([
      request(app).get(`/api/v1/storage-locations/${ctx.fridgeId}`).set(auth(adminB)),
      request(app).patch(`/api/v1/storage-locations/${ctx.fridgeId}`).set(auth(adminB)).send({ name: 'Mine' }),
      request(app).get('/api/v1/storage-locations').set(auth(adminB)),
    ]);
    expect(get.status).toBe(404);
    expect(patch.status).toBe(404);
    expect(list.body.data).toHaveLength(0);

    const ctxB = await prepare(adminB, 'B');
    const product = await request(app).post('/api/v1/products').set(auth(adminB)).send({
      name: 'Stolen spot',
      categoryId: ctxB.categoryId,
      unitId: ctxB.unitId,
      storageLocationId: ctx.fridgeId,
    });
    expect(product.status).toBe(400);
  });

  it('refuses a location in another company\'s warehouse when creating one', async () => {
    const res = await createLocation(adminB, { warehouseId: ctx.mainId, name: 'Sneaky' });
    expect(res.status).toBe(400);
  });
});
