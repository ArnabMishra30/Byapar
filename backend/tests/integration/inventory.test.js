import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma, resetDatabase, createCompanyWithUsers, login } from '../helpers/db.js';

const auth = (token) => ({ Authorization: `Bearer ${token}` });

let companyA;
let companyB;
let adminA;
let staffA;
let adminB;
let ctxA;
let ctxB;

/** Creates the master data a stock movement needs, inside one company. */
async function prepareCompany(token, suffix) {
  const category = await request(app)
    .post('/api/v1/categories')
    .set(auth(token))
    .send({ name: `Tablets ${suffix}` });

  const unit = await request(app)
    .post('/api/v1/units')
    .set(auth(token))
    .send({ name: `Strip ${suffix}`, shortCode: `ST${suffix}` });

  const product = await request(app)
    .post('/api/v1/products')
    .set(auth(token))
    .send({
      name: `Paracetamol ${suffix}`,
      sku: `SKU-${suffix}`,
      categoryId: category.body.data.category.id,
      unitId: unit.body.data.unit.id,
    });

  const secondProduct = await request(app)
    .post('/api/v1/products')
    .set(auth(token))
    .send({
      name: `Amoxicillin ${suffix}`,
      sku: `SKU2-${suffix}`,
      categoryId: category.body.data.category.id,
      unitId: unit.body.data.unit.id,
    });

  const warehouse = await request(app)
    .post('/api/v1/warehouses')
    .set(auth(token))
    .send({ name: `Main ${suffix}`, code: `MN${suffix}` });

  const secondWarehouse = await request(app)
    .post('/api/v1/warehouses')
    .set(auth(token))
    .send({ name: `Branch ${suffix}`, code: `BR${suffix}` });

  return {
    categoryId: category.body.data.category.id,
    unitId: unit.body.data.unit.id,
    productId: product.body.data.product.id,
    productId2: secondProduct.body.data.product.id,
    warehouseId: warehouse.body.data.warehouse.id,
    warehouseId2: secondWarehouse.body.data.warehouse.id,
  };
}

async function openingStock(token, body) {
  return request(app).post('/api/v1/inventory/opening-stock').set(auth(token)).send(body);
}

async function adjust(token, body) {
  return request(app).post('/api/v1/inventory/adjustments').set(auth(token)).send(body);
}

async function readBalance(token, productId, warehouseId) {
  return request(app).get(`/api/v1/inventory/${productId}/${warehouseId}`).set(auth(token));
}

beforeAll(async () => {
  await resetDatabase();

  companyA = await createCompanyWithUsers('alpha');
  companyB = await createCompanyWithUsers('beta');

  adminA = await login(app, companyA.admin.email, companyA.adminPassword);
  staffA = await login(app, companyA.staff.email, companyA.staffPassword);
  adminB = await login(app, companyB.admin.email, companyB.adminPassword);

  ctxA = await prepareCompany(adminA, 'A');
  ctxB = await prepareCompany(adminB, 'B');
});

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

/** Wipes only inventory, leaving master data, so each block starts from zero stock. */
async function resetInventory() {
  // The general ledger, first: journal lines reference accounts, and a leftover
  // journal entry would collide with a later journal number.
  await prisma.expense.deleteMany();
  await prisma.journalLine.deleteMany();
  await prisma.journalEntry.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.inventoryBalance.deleteMany();
}

describe('inventory: opening stock', () => {
  beforeEach(resetInventory);

  it('reports zero stock before any movement', async () => {
    const response = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);

    expect(response.status).toBe(200);
    expect(response.body.data.balance.quantity).toBe('0.000');
    expect(response.body.data.balance.averageCost).toBe('0.0000');
    expect(response.body.data.balance.inventoryValue).toBe('0.00');
  });

  it('lists no balances before any movement', async () => {
    const response = await request(app).get('/api/v1/inventory').set(auth(adminA));

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(0);
    expect(response.body.pagination.total).toBe(0);
  });

  it('creates a balance with the correct quantity and average cost', async () => {
    const response = await openingStock(adminA, {
      productId: ctxA.productId,
      warehouseId: ctxA.warehouseId,
      quantity: '100',
      unitCost: '10.00',
      notes: 'Initial stock',
    });

    expect(response.status).toBe(201);

    const balance = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    expect(balance.body.data.balance.quantity).toBe('100.000');
    expect(balance.body.data.balance.averageCost).toBe('10.0000');
    expect(balance.body.data.balance.inventoryValue).toBe('1000.00');
  });

  it('creates a matching movement with before and after values', async () => {
    await openingStock(adminA, {
      productId: ctxA.productId,
      warehouseId: ctxA.warehouseId,
      quantity: '100',
      unitCost: '10.00',
      notes: 'Initial stock',
    });

    const movements = await request(app)
      .get(`/api/v1/inventory/movements?productId=${ctxA.productId}`)
      .set(auth(adminA));

    expect(movements.body.pagination.total).toBe(1);

    const movement = movements.body.data[0];
    expect(movement.type).toBe('OPENING_STOCK');
    expect(movement.quantity).toBe('100.000');
    expect(movement.unitCost).toBe('10.0000');
    expect(movement.totalCost).toBe('1000.00');
    expect(movement.quantityBefore).toBe('0.000');
    expect(movement.quantityAfter).toBe('100.000');
    expect(movement.averageCostBefore).toBe('0.0000');
    expect(movement.averageCostAfter).toBe('10.0000');
    expect(movement.referenceType).toBe('OPENING_STOCK');
    expect(movement.notes).toBe('Initial stock');
  });

  it('records who created the movement, without leaking user details', async () => {
    await openingStock(adminA, {
      productId: ctxA.productId,
      warehouseId: ctxA.warehouseId,
      quantity: '10',
      unitCost: '5',
    });

    const movements = await request(app).get('/api/v1/inventory/movements').set(auth(adminA));
    const movement = movements.body.data[0];

    expect(movement.createdBy.id).toBe(companyA.admin.id);
    expect(movement.createdBy.name).toBe(companyA.admin.name);
    expect(movement.createdBy.email).toBeUndefined();
    expect(JSON.stringify(movements.body)).not.toContain('passwordHash');
  });

  it('ignores a createdById supplied by the client', async () => {
    await openingStock(adminA, {
      productId: ctxA.productId,
      warehouseId: ctxA.warehouseId,
      quantity: '10',
      unitCost: '5',
      createdById: companyB.admin.id,
    });

    const movements = await request(app).get('/api/v1/inventory/movements').set(auth(adminA));
    expect(movements.body.data[0].createdBy.id).toBe(companyA.admin.id);
  });

  it('rejects a second opening stock for the same product and warehouse', async () => {
    await openingStock(adminA, {
      productId: ctxA.productId,
      warehouseId: ctxA.warehouseId,
      quantity: '100',
      unitCost: '10',
    });

    const duplicate = await openingStock(adminA, {
      productId: ctxA.productId,
      warehouseId: ctxA.warehouseId,
      quantity: '50',
      unitCost: '20',
    });

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('OPENING_STOCK_ALREADY_EXISTS');

    // Nothing changed.
    const balance = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    expect(balance.body.data.balance.quantity).toBe('100.000');

    const movements = await request(app).get('/api/v1/inventory/movements').set(auth(adminA));
    expect(movements.body.pagination.total).toBe(1);
  });

  it('allows opening stock for the same product in a different warehouse', async () => {
    await openingStock(adminA, {
      productId: ctxA.productId,
      warehouseId: ctxA.warehouseId,
      quantity: '100',
      unitCost: '10',
    });

    const second = await openingStock(adminA, {
      productId: ctxA.productId,
      warehouseId: ctxA.warehouseId2,
      quantity: '50',
      unitCost: '12',
    });

    expect(second.status).toBe(201);
  });

  it('accepts a zero unit cost', async () => {
    const response = await openingStock(adminA, {
      productId: ctxA.productId,
      warehouseId: ctxA.warehouseId,
      quantity: '10',
      unitCost: '0',
    });

    expect(response.status).toBe(201);
    expect(response.body.data.movement.averageCostAfter).toBe('0.0000');
  });

  it('rejects a zero or negative quantity', async () => {
    const zero = await openingStock(adminA, {
      productId: ctxA.productId,
      warehouseId: ctxA.warehouseId,
      quantity: '0',
      unitCost: '10',
    });
    const negative = await openingStock(adminA, {
      productId: ctxA.productId,
      warehouseId: ctxA.warehouseId,
      quantity: '-5',
      unitCost: '10',
    });

    expect(zero.status).toBe(400);
    expect(negative.status).toBe(400);
  });

  it('rejects a negative unit cost', async () => {
    const response = await openingStock(adminA, {
      productId: ctxA.productId,
      warehouseId: ctxA.warehouseId,
      quantity: '10',
      unitCost: '-1',
    });

    expect(response.status).toBe(400);
    expect(response.body.errors[0].field).toBe('body.unitCost');
  });

  it('rejects a missing product or warehouse id', async () => {
    const response = await openingStock(adminA, { quantity: '10', unitCost: '10' });

    expect(response.status).toBe(400);
    const fields = response.body.errors.map((e) => e.field);
    expect(fields).toContain('body.productId');
    expect(fields).toContain('body.warehouseId');
  });
});

describe('inventory: moving weighted average', () => {
  beforeEach(resetInventory);

  it('follows the documented formula: 100 @ 10 then +50 @ 14 = 150 @ 11.3333', async () => {
    await openingStock(adminA, {
      productId: ctxA.productId,
      warehouseId: ctxA.warehouseId,
      quantity: '100',
      unitCost: '10.00',
    });

    const adjustment = await adjust(adminA, {
      productId: ctxA.productId,
      warehouseId: ctxA.warehouseId,
      type: 'ADJUSTMENT_IN',
      quantity: '50',
      unitCost: '14.00',
    });

    expect(adjustment.status).toBe(201);
    // (100*10 + 50*14) / 150 = 1700/150 = 11.333333...
    expect(adjustment.body.data.movement.averageCostBefore).toBe('10.0000');
    expect(adjustment.body.data.movement.averageCostAfter).toBe('11.3333');

    const balance = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    expect(balance.body.data.balance.quantity).toBe('150.000');
    expect(balance.body.data.balance.averageCost).toBe('11.3333');
    // 150 * 11.3333 = 1699.995, rounded half-up once at serialization.
    // Note this is 0.005 below the 1700.00 originally paid: that is the inherent,
    // documented rounding residue of storing an average at 4 decimal places.
    expect(balance.body.data.balance.inventoryValue).toBe('1700.00');
  });

  it('leaves the average cost unchanged when stock goes out', async () => {
    await openingStock(adminA, {
      productId: ctxA.productId,
      warehouseId: ctxA.warehouseId,
      quantity: '100',
      unitCost: '10.00',
    });
    await adjust(adminA, {
      productId: ctxA.productId,
      warehouseId: ctxA.warehouseId,
      type: 'ADJUSTMENT_IN',
      quantity: '50',
      unitCost: '14.00',
    });

    const out = await adjust(adminA, {
      productId: ctxA.productId,
      warehouseId: ctxA.warehouseId,
      type: 'ADJUSTMENT_OUT',
      quantity: '50',
    });

    expect(out.status).toBe(201);
    expect(out.body.data.movement.averageCostBefore).toBe('11.3333');
    expect(out.body.data.movement.averageCostAfter).toBe('11.3333');
    // Outgoing stock is valued at the current average.
    expect(out.body.data.movement.unitCost).toBe('11.3333');
    expect(out.body.data.movement.totalCost).toBe('566.67'); // 50 * 11.3333

    const balance = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    expect(balance.body.data.balance.quantity).toBe('100.000');
    expect(balance.body.data.balance.averageCost).toBe('11.3333');
  });

  it('uses the incoming cost as the average when there was no stock', async () => {
    const response = await adjust(adminA, {
      productId: ctxA.productId,
      warehouseId: ctxA.warehouseId,
      type: 'ADJUSTMENT_IN',
      quantity: '25',
      unitCost: '7.50',
    });

    expect(response.status).toBe(201);
    expect(response.body.data.movement.averageCostAfter).toBe('7.5000');
  });

  it('keeps the average cost when stock reaches exactly zero', async () => {
    await openingStock(adminA, {
      productId: ctxA.productId,
      warehouseId: ctxA.warehouseId,
      quantity: '10',
      unitCost: '9.00',
    });

    await adjust(adminA, {
      productId: ctxA.productId,
      warehouseId: ctxA.warehouseId,
      type: 'ADJUSTMENT_OUT',
      quantity: '10',
    });

    const balance = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    expect(balance.body.data.balance.quantity).toBe('0.000');
    // The balance row survives and remembers the cost, for audit and for the
    // next time stock arrives.
    expect(balance.body.data.balance.averageCost).toBe('9.0000');
    expect(balance.body.data.balance.inventoryValue).toBe('0.00');

    const rows = await prisma.inventoryBalance.count({
      where: { productId: ctxA.productId, warehouseId: ctxA.warehouseId },
    });
    expect(rows).toBe(1);
  });

  it('handles fractional quantities without floating point drift', async () => {
    await openingStock(adminA, {
      productId: ctxA.productId,
      warehouseId: ctxA.warehouseId,
      quantity: '0.1',
      unitCost: '0.10',
    });

    await adjust(adminA, {
      productId: ctxA.productId,
      warehouseId: ctxA.warehouseId,
      type: 'ADJUSTMENT_IN',
      quantity: '0.2',
      unitCost: '0.10',
    });

    const balance = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    // 0.1 + 0.2 is exactly 0.3, not 0.30000000000000004
    expect(balance.body.data.balance.quantity).toBe('0.300');
    expect(balance.body.data.balance.averageCost).toBe('0.1000');
  });
});

describe('inventory: adjustments and negative stock', () => {
  beforeEach(async () => {
    await resetInventory();
    await openingStock(adminA, {
      productId: ctxA.productId,
      warehouseId: ctxA.warehouseId,
      quantity: '10',
      unitCost: '10.00',
    });
  });

  it('rejects removing more stock than exists and changes nothing', async () => {
    const response = await adjust(adminA, {
      productId: ctxA.productId,
      warehouseId: ctxA.warehouseId,
      type: 'ADJUSTMENT_OUT',
      quantity: '15',
    });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('INSUFFICIENT_STOCK');

    const balance = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    expect(balance.body.data.balance.quantity).toBe('10.000');

    // No movement was written for the rejected attempt.
    const movements = await request(app).get('/api/v1/inventory/movements').set(auth(adminA));
    expect(movements.body.pagination.total).toBe(1);
  });

  it('rejects removing stock from a product that has none', async () => {
    const response = await adjust(adminA, {
      productId: ctxA.productId2,
      warehouseId: ctxA.warehouseId,
      type: 'ADJUSTMENT_OUT',
      quantity: '1',
    });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('INSUFFICIENT_STOCK');

    const balances = await prisma.inventoryBalance.count({ where: { productId: ctxA.productId2 } });
    expect(balances).toBe(0);
  });

  it('allows removing exactly all the stock', async () => {
    const response = await adjust(adminA, {
      productId: ctxA.productId,
      warehouseId: ctxA.warehouseId,
      type: 'ADJUSTMENT_OUT',
      quantity: '10',
    });

    expect(response.status).toBe(201);
    expect(response.body.data.movement.quantityAfter).toBe('0.000');
  });

  it('requires a unit cost for ADJUSTMENT_IN', async () => {
    const response = await adjust(adminA, {
      productId: ctxA.productId,
      warehouseId: ctxA.warehouseId,
      type: 'ADJUSTMENT_IN',
      quantity: '5',
    });

    expect(response.status).toBe(400);
    expect(response.body.errors[0].field).toBe('body.unitCost');
  });

  it('refuses a unit cost for ADJUSTMENT_OUT', async () => {
    const response = await adjust(adminA, {
      productId: ctxA.productId,
      warehouseId: ctxA.warehouseId,
      type: 'ADJUSTMENT_OUT',
      quantity: '5',
      unitCost: '99',
    });

    expect(response.status).toBe(400);
    expect(response.body.errors[0].field).toBe('body.unitCost');
  });

  it('rejects an unknown adjustment type', async () => {
    const response = await adjust(adminA, {
      productId: ctxA.productId,
      warehouseId: ctxA.warehouseId,
      type: 'STOCK_OUT',
      quantity: '1',
    });

    expect(response.status).toBe(400);
  });

  it('keeps the balance equal to the sum of its movements', async () => {
    await adjust(adminA, {
      productId: ctxA.productId,
      warehouseId: ctxA.warehouseId,
      type: 'ADJUSTMENT_IN',
      quantity: '20',
      unitCost: '10',
    });
    await adjust(adminA, {
      productId: ctxA.productId,
      warehouseId: ctxA.warehouseId,
      type: 'ADJUSTMENT_OUT',
      quantity: '5',
    });

    // Opening +10, adjustment +20, adjustment -5 = 25
    const balance = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    expect(balance.body.data.balance.quantity).toBe('25.000');

    const movements = await prisma.stockMovement.findMany({
      where: { productId: ctxA.productId, warehouseId: ctxA.warehouseId },
    });

    const expected = movements.reduce((total, movement) => {
      const signed = movement.type.endsWith('_OUT') ? -Number(movement.quantity) : Number(movement.quantity);
      return total + signed;
    }, 0);

    expect(expected).toBe(25);
    expect(movements).toHaveLength(3);

    // And every movement's quantityAfter matches the next one's quantityBefore.
    const ordered = [...movements].sort((a, b) => a.createdAt - b.createdAt);
    for (let i = 1; i < ordered.length; i += 1) {
      expect(String(ordered[i].quantityBefore)).toBe(String(ordered[i - 1].quantityAfter));
    }
  });
});

describe('inventory: multiple products and warehouses', () => {
  beforeEach(resetInventory);

  it('keeps warehouses separate for the same product', async () => {
    await openingStock(adminA, {
      productId: ctxA.productId,
      warehouseId: ctxA.warehouseId,
      quantity: '100',
      unitCost: '10',
    });
    await openingStock(adminA, {
      productId: ctxA.productId,
      warehouseId: ctxA.warehouseId2,
      quantity: '50',
      unitCost: '20',
    });

    const main = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    const branch = await readBalance(adminA, ctxA.productId, ctxA.warehouseId2);

    expect(main.body.data.balance.quantity).toBe('100.000');
    expect(main.body.data.balance.averageCost).toBe('10.0000');
    expect(branch.body.data.balance.quantity).toBe('50.000');
    expect(branch.body.data.balance.averageCost).toBe('20.0000');
  });

  it('keeps products separate in the same warehouse', async () => {
    await openingStock(adminA, {
      productId: ctxA.productId,
      warehouseId: ctxA.warehouseId,
      quantity: '100',
      unitCost: '10',
    });
    await openingStock(adminA, {
      productId: ctxA.productId2,
      warehouseId: ctxA.warehouseId,
      quantity: '7',
      unitCost: '3',
    });

    const list = await request(app).get('/api/v1/inventory').set(auth(adminA));
    expect(list.body.pagination.total).toBe(2);
  });

  it('filters the list by warehouse and by product', async () => {
    await openingStock(adminA, {
      productId: ctxA.productId,
      warehouseId: ctxA.warehouseId,
      quantity: '100',
      unitCost: '10',
    });
    await openingStock(adminA, {
      productId: ctxA.productId,
      warehouseId: ctxA.warehouseId2,
      quantity: '50',
      unitCost: '20',
    });

    const byWarehouse = await request(app)
      .get(`/api/v1/inventory?warehouseId=${ctxA.warehouseId2}`)
      .set(auth(adminA));
    const byProduct = await request(app)
      .get(`/api/v1/inventory?productId=${ctxA.productId}`)
      .set(auth(adminA));

    expect(byWarehouse.body.data).toHaveLength(1);
    expect(byWarehouse.body.data[0].quantity).toBe('50.000');
    expect(byProduct.body.data).toHaveLength(2);
  });

  it('returns the standard pagination block', async () => {
    await openingStock(adminA, {
      productId: ctxA.productId,
      warehouseId: ctxA.warehouseId,
      quantity: '1',
      unitCost: '1',
    });

    const response = await request(app).get('/api/v1/inventory?page=1&limit=1').set(auth(adminA));

    expect(response.body.pagination).toMatchObject({ page: 1, limit: 1 });
    expect(response.body.pagination.totalPages).toBeGreaterThan(0);
  });

  it('rejects a limit above the maximum', async () => {
    const response = await request(app).get('/api/v1/inventory?limit=500').set(auth(adminA));
    expect(response.status).toBe(400);
  });
});

describe('inventory: inactive master data', () => {
  beforeEach(resetInventory);

  it('refuses a stock movement for an inactive product', async () => {
    await request(app)
      .patch(`/api/v1/products/${ctxA.productId2}/status`)
      .set(auth(adminA))
      .send({ isActive: false });

    const response = await openingStock(adminA, {
      productId: ctxA.productId2,
      warehouseId: ctxA.warehouseId,
      quantity: '10',
      unitCost: '10',
    });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('PRODUCT_INACTIVE');

    await request(app)
      .patch(`/api/v1/products/${ctxA.productId2}/status`)
      .set(auth(adminA))
      .send({ isActive: true });
  });

  it('refuses a stock movement for an inactive warehouse', async () => {
    await request(app)
      .patch(`/api/v1/warehouses/${ctxA.warehouseId2}/status`)
      .set(auth(adminA))
      .send({ isActive: false });

    const response = await openingStock(adminA, {
      productId: ctxA.productId,
      warehouseId: ctxA.warehouseId2,
      quantity: '10',
      unitCost: '10',
    });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('WAREHOUSE_INACTIVE');

    await request(app)
      .patch(`/api/v1/warehouses/${ctxA.warehouseId2}/status`)
      .set(auth(adminA))
      .send({ isActive: true });
  });

  it('still allows reading the stock of a product that was deactivated later', async () => {
    await openingStock(adminA, {
      productId: ctxA.productId2,
      warehouseId: ctxA.warehouseId,
      quantity: '10',
      unitCost: '10',
    });

    await request(app)
      .patch(`/api/v1/products/${ctxA.productId2}/status`)
      .set(auth(adminA))
      .send({ isActive: false });

    const balance = await readBalance(adminA, ctxA.productId2, ctxA.warehouseId);
    expect(balance.status).toBe(200);
    expect(balance.body.data.balance.quantity).toBe('10.000');

    await request(app)
      .patch(`/api/v1/products/${ctxA.productId2}/status`)
      .set(auth(adminA))
      .send({ isActive: true });
  });
});

describe('inventory: authorization', () => {
  beforeEach(async () => {
    await resetInventory();
    await openingStock(adminA, {
      productId: ctxA.productId,
      warehouseId: ctxA.warehouseId,
      quantity: '10',
      unitCost: '10',
    });
  });

  it('requires authentication on every endpoint', async () => {
    const list = await request(app).get('/api/v1/inventory');
    const movements = await request(app).get('/api/v1/inventory/movements');
    const opening = await request(app).post('/api/v1/inventory/opening-stock').send({});
    const adjustment = await request(app).post('/api/v1/inventory/adjustments').send({});

    expect(list.status).toBe(401);
    expect(movements.status).toBe(401);
    expect(opening.status).toBe(401);
    expect(adjustment.status).toBe(401);
  });

  it('lets STAFF read balances and movements', async () => {
    const list = await request(app).get('/api/v1/inventory').set(auth(staffA));
    const movements = await request(app).get('/api/v1/inventory/movements').set(auth(staffA));
    const one = await readBalance(staffA, ctxA.productId, ctxA.warehouseId);

    expect(list.status).toBe(200);
    expect(movements.status).toBe(200);
    expect(one.status).toBe(200);
  });

  it('forbids STAFF from recording opening stock', async () => {
    const response = await openingStock(staffA, {
      productId: ctxA.productId2,
      warehouseId: ctxA.warehouseId,
      quantity: '10',
      unitCost: '10',
    });

    expect(response.status).toBe(403);
    expect(await prisma.inventoryBalance.count({ where: { productId: ctxA.productId2 } })).toBe(0);
  });

  it('forbids STAFF from adjusting stock', async () => {
    const response = await adjust(staffA, {
      productId: ctxA.productId,
      warehouseId: ctxA.warehouseId,
      type: 'ADJUSTMENT_OUT',
      quantity: '1',
    });

    expect(response.status).toBe(403);

    const balance = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    expect(balance.body.data.balance.quantity).toBe('10.000');
  });
});

describe('inventory: movement immutability', () => {
  beforeEach(async () => {
    await resetInventory();
    await openingStock(adminA, {
      productId: ctxA.productId,
      warehouseId: ctxA.warehouseId,
      quantity: '10',
      unitCost: '10',
    });
  });

  it('has no update or delete endpoint for movements', async () => {
    const movements = await request(app).get('/api/v1/inventory/movements').set(auth(adminA));
    const id = movements.body.data[0].id;

    const put = await request(app)
      .put(`/api/v1/inventory/movements/${id}`)
      .set(auth(adminA))
      .send({ quantity: '999' });
    const patch = await request(app)
      .patch(`/api/v1/inventory/movements/${id}`)
      .set(auth(adminA))
      .send({ quantity: '999' });
    const remove = await request(app)
      .delete(`/api/v1/inventory/movements/${id}`)
      .set(auth(adminA));

    expect(put.status).toBe(404);
    expect(patch.status).toBe(404);
    expect(remove.status).toBe(404);
  });

  it('reads a single movement by id', async () => {
    const movements = await request(app).get('/api/v1/inventory/movements').set(auth(adminA));
    const id = movements.body.data[0].id;

    const response = await request(app).get(`/api/v1/inventory/movements/${id}`).set(auth(adminA));

    expect(response.status).toBe(200);
    expect(response.body.data.movement.id).toBe(id);
  });

  it('filters movements by type and date range', async () => {
    await adjust(adminA, {
      productId: ctxA.productId,
      warehouseId: ctxA.warehouseId,
      type: 'ADJUSTMENT_IN',
      quantity: '5',
      unitCost: '10',
    });

    const byType = await request(app)
      .get('/api/v1/inventory/movements?type=ADJUSTMENT_IN')
      .set(auth(adminA));
    expect(byType.body.pagination.total).toBe(1);

    const tomorrow = new Date(Date.now() + 86400000).toISOString();
    const future = await request(app)
      .get(`/api/v1/inventory/movements?fromDate=${tomorrow}`)
      .set(auth(adminA));
    expect(future.body.pagination.total).toBe(0);

    const yesterday = new Date(Date.now() - 86400000).toISOString();
    const past = await request(app)
      .get(`/api/v1/inventory/movements?fromDate=${yesterday}`)
      .set(auth(adminA));
    expect(past.body.pagination.total).toBe(2);
  });

  it('rejects an invalid date filter', async () => {
    const response = await request(app)
      .get('/api/v1/inventory/movements?fromDate=not-a-date')
      .set(auth(adminA));

    expect(response.status).toBe(400);
  });
});

describe('inventory: tenant isolation', () => {
  beforeEach(async () => {
    await resetInventory();
    await openingStock(adminA, {
      productId: ctxA.productId,
      warehouseId: ctxA.warehouseId,
      quantity: '100',
      unitCost: '10',
    });
    await openingStock(adminB, {
      productId: ctxB.productId,
      warehouseId: ctxB.warehouseId,
      quantity: '77',
      unitCost: '5',
    });
  });

  it('lists only the current company balances', async () => {
    const listA = await request(app).get('/api/v1/inventory').set(auth(adminA));
    const listB = await request(app).get('/api/v1/inventory').set(auth(adminB));

    expect(listA.body.pagination.total).toBe(1);
    expect(listA.body.data[0].quantity).toBe('100.000');
    expect(listB.body.data[0].quantity).toBe('77.000');
    expect(listA.body.data[0].product.id).not.toBe(listB.body.data[0].product.id);
  });

  it('lists only the current company movements', async () => {
    const movementsA = await request(app).get('/api/v1/inventory/movements').set(auth(adminA));

    expect(movementsA.body.pagination.total).toBe(1);
    expect(movementsA.body.data[0].product.id).toBe(ctxA.productId);
  });

  it('returns 404 when reading another company balance', async () => {
    const response = await readBalance(adminA, ctxB.productId, ctxB.warehouseId);
    expect(response.status).toBe(404);
  });

  it('returns 404 when reading another company movement by id', async () => {
    const movementsB = await request(app).get('/api/v1/inventory/movements').set(auth(adminB));
    const idB = movementsB.body.data[0].id;

    const response = await request(app).get(`/api/v1/inventory/movements/${idB}`).set(auth(adminA));
    expect(response.status).toBe(404);
  });

  it('refuses opening stock using another company product', async () => {
    const response = await openingStock(adminA, {
      productId: ctxB.productId,
      warehouseId: ctxA.warehouseId,
      quantity: '10',
      unitCost: '10',
    });

    expect(response.status).toBe(400);
    expect(response.body.errors[0].field).toBe('body.productId');
    expect(await prisma.inventoryBalance.count({ where: { productId: ctxB.productId } })).toBe(1);
  });

  it('refuses opening stock using another company warehouse', async () => {
    const response = await openingStock(adminA, {
      productId: ctxA.productId,
      warehouseId: ctxB.warehouseId,
      quantity: '10',
      unitCost: '10',
    });

    expect(response.status).toBe(400);
    expect(response.body.errors[0].field).toBe('body.warehouseId');
  });

  it('refuses an adjustment against another company product', async () => {
    const response = await adjust(adminA, {
      productId: ctxB.productId,
      warehouseId: ctxB.warehouseId,
      type: 'ADJUSTMENT_OUT',
      quantity: '1',
    });

    expect(response.status).toBe(400);

    // Company B stock is untouched.
    const balanceB = await readBalance(adminB, ctxB.productId, ctxB.warehouseId);
    expect(balanceB.body.data.balance.quantity).toBe('77.000');
  });

  it('ignores a companyId sent in the body', async () => {
    const response = await openingStock(adminA, {
      productId: ctxA.productId2,
      warehouseId: ctxA.warehouseId,
      quantity: '10',
      unitCost: '10',
      companyId: companyB.company.id,
    });

    expect(response.status).toBe(201);

    const stored = await prisma.inventoryBalance.findFirst({ where: { productId: ctxA.productId2 } });
    expect(stored.companyId).toBe(companyA.company.id);
  });
});

describe('inventory: concurrency', () => {
  beforeEach(resetInventory);

  it('does not lose updates when 10 adjustments run at the same time', async () => {
    await openingStock(adminA, {
      productId: ctxA.productId,
      warehouseId: ctxA.warehouseId,
      quantity: '100',
      unitCost: '10.00',
    });

    // Ten simultaneous +10 @ 10.00. Without row locking these would read the same
    // starting quantity and overwrite each other.
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        adjust(adminA, {
          productId: ctxA.productId,
          warehouseId: ctxA.warehouseId,
          type: 'ADJUSTMENT_IN',
          quantity: '10',
          unitCost: '10.00',
        }),
      ),
    );

    expect(results.every((r) => r.status === 201)).toBe(true);

    const balance = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    expect(balance.body.data.balance.quantity).toBe('200.000');
    // Every unit cost 10.00, so the average must still be exactly 10.
    expect(balance.body.data.balance.averageCost).toBe('10.0000');

    const movements = await prisma.stockMovement.count({
      where: { productId: ctxA.productId, warehouseId: ctxA.warehouseId },
    });
    expect(movements).toBe(11); // 1 opening + 10 adjustments

    // The ledger must add up to the balance.
    const rows = await prisma.stockMovement.findMany({
      where: { productId: ctxA.productId, warehouseId: ctxA.warehouseId },
    });
    const sum = rows.reduce(
      (total, m) => total + (m.type.endsWith('_OUT') ? -Number(m.quantity) : Number(m.quantity)),
      0,
    );
    expect(sum).toBe(200);
  });

  it('creates exactly one balance row when concurrent movements race to create it', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        adjust(adminA, {
          productId: ctxA.productId2,
          warehouseId: ctxA.warehouseId,
          type: 'ADJUSTMENT_IN',
          quantity: '2',
          unitCost: '5.00',
        }),
      ),
    );

    expect(results.every((r) => r.status === 201)).toBe(true);

    const rows = await prisma.inventoryBalance.findMany({
      where: { productId: ctxA.productId2, warehouseId: ctxA.warehouseId },
    });

    expect(rows).toHaveLength(1);
    expect(Number(rows[0].quantity)).toBe(10);
    expect(Number(rows[0].averageCost)).toBe(5);
  });

  it('does not oversell under concurrent outgoing adjustments', async () => {
    await openingStock(adminA, {
      productId: ctxA.productId,
      warehouseId: ctxA.warehouseId,
      quantity: '10',
      unitCost: '10.00',
    });

    // Five concurrent requests each removing 4 units from a stock of 10.
    // At most two can succeed; the rest must be rejected, and stock must never
    // go negative.
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        adjust(adminA, {
          productId: ctxA.productId,
          warehouseId: ctxA.warehouseId,
          type: 'ADJUSTMENT_OUT',
          quantity: '4',
        }),
      ),
    );

    const succeeded = results.filter((r) => r.status === 201).length;
    const rejected = results.filter((r) => r.status === 422).length;

    expect(succeeded).toBe(2);
    expect(rejected).toBe(3);

    const balance = await readBalance(adminA, ctxA.productId, ctxA.warehouseId);
    expect(balance.body.data.balance.quantity).toBe('2.000');
  });
});
