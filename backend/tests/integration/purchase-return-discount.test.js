import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma, resetDatabase, createCompanyWithUsers, login } from '../helpers/db.js';

// Regression coverage for QA finding H1.
//
// A purchase return must hand back a PRO-RATA share of the original purchase
// line's discount. Before the fix the return credited the supplier for the
// GROSS cost (quantity * unitCost) and reversed input GST on that gross figure,
// so both the supplier credit and the input-tax reversal were overstated
// whenever a purchase line carried a discount. These tests post real purchases
// with discounts and assert the return credits/reverses the NET amount, and
// that the supplier payable is reduced by that net amount.

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const HOME_STATE = '27';
const COMPANY_GSTIN = '27AAPFU0939F1ZV';

let plain;
let gst;
let adminPlain;
let adminGst;
let ctxPlain;
let ctxGst;

async function makeMasters(token, suffix, { gst: withGst = false } = {}) {
  const post = (path, body) => request(app).post(path).set(auth(token)).send(body);

  const category = await post('/api/v1/categories', { name: `DRet Cat ${suffix}` });
  const unit = await post('/api/v1/units', { name: `DRet Unit ${suffix}`, shortCode: `DU${suffix}` });

  const productBody = {
    name: `DRet Prod ${suffix}`,
    sku: `DRET-${suffix}`,
    categoryId: category.body.data.category.id,
    unitId: unit.body.data.unit.id,
  };

  let taxId = null;
  if (withGst) {
    const tax = await post('/api/v1/taxes', { name: `DRet Tax18 ${suffix}`, rate: '18' });
    taxId = tax.body.data.tax.id;
    const hsn = await post('/api/v1/tax/classifications', {
      code: '30049011',
      kind: 'HSN',
      description: 'Medicaments',
    });
    expect(hsn.status).toBe(201);
    productBody.taxClassificationId = hsn.body.data.classification.id;
  } else {
    productBody.purchasePrice = '100';
  }

  const product = await post('/api/v1/products', productBody);
  expect(product.status).toBe(201);

  const supplier = await post(
    '/api/v1/suppliers',
    withGst
      ? { name: `DRet Sup ${suffix}`, stateCode: HOME_STATE, gstRegistrationType: 'REGULAR' }
      : { name: `DRet Sup ${suffix}` },
  );
  const warehouse = await post(
    '/api/v1/warehouses',
    withGst
      ? { name: `DRet WH ${suffix}`, code: `DW${suffix}`, stateCode: HOME_STATE }
      : { name: `DRet WH ${suffix}`, code: `DW${suffix}` },
  );

  return {
    productId: product.body.data.product.id,
    supplierId: supplier.body.data.supplier.id,
    warehouseId: warehouse.body.data.warehouse.id,
    taxId,
  };
}

/** Posts a one-line purchase and returns the posted document. */
async function postPurchase(token, ctx, item) {
  const created = await request(app)
    .post('/api/v1/purchases')
    .set(auth(token))
    .send({
      supplierId: ctx.supplierId,
      warehouseId: ctx.warehouseId,
      invoiceNumber: `DRET-${Math.random().toString(36).slice(2, 10)}`,
      invoiceDate: '2026-08-28',
      items: [item],
    });
  expect(created.status).toBe(201);

  const posted = await request(app)
    .post(`/api/v1/purchases/${created.body.data.purchase.id}/post`)
    .set(auth(token));
  expect(posted.status).toBe(200);
  return posted.body.data.purchase;
}

const createReturn = (token, body) =>
  request(app).post('/api/v1/purchase-returns').set(auth(token)).send(body);

const postReturn = (token, id) =>
  request(app).post(`/api/v1/purchase-returns/${id}/post`).set(auth(token));

const payableFor = (purchaseId) =>
  prisma.supplierPayable.findUnique({ where: { purchaseId } });

beforeAll(async () => {
  await resetDatabase();

  plain = await createCompanyWithUsers('disc-plain');
  gst = await createCompanyWithUsers('disc-gst');

  adminPlain = await login(app, plain.admin.email, plain.adminPassword);
  adminGst = await login(app, gst.admin.email, gst.adminPassword);

  await request(app)
    .patch('/api/v1/tax/profile')
    .set(auth(adminGst))
    .send({ stateCode: HOME_STATE, gstin: COMPANY_GSTIN, registrationType: 'REGULAR' });

  ctxPlain = await makeMasters(adminPlain, 'P');
  ctxGst = await makeMasters(adminGst, 'G', { gst: true });
});

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

describe('H1 — purchase return discount proration (no GST)', () => {
  it('credits the NET amount on a full return of a discounted line, not the gross', async () => {
    // 10 @ 100 = 1000 gross, 10% discount = 100 -> 900 taxable, payable 900.
    const purchase = await postPurchase(adminPlain, ctxPlain, {
      productId: ctxPlain.productId,
      quantity: '10',
      unitCost: '100',
      discountType: 'PERCENTAGE',
      discountValue: '10',
    });
    expect(purchase.grandTotal).toBe('900.00');

    const draft = await createReturn(adminPlain, {
      purchaseId: purchase.id,
      returnDate: '2026-08-30',
      items: [{ purchaseItemId: purchase.items[0].id, quantity: '10' }],
    });
    expect(draft.status).toBe(201);
    // The credit is the net 900, NOT the gross 1000 (the pre-fix bug).
    expect(draft.body.data.purchaseReturn.taxableTotal).toBe('900.00');
    expect(draft.body.data.purchaseReturn.taxTotal).toBe('0.00');
    expect(draft.body.data.purchaseReturn.grandTotal).toBe('900.00');
    expect(draft.body.data.purchaseReturn.items[0].lineTotal).toBe('900.00');

    const posted = await postReturn(adminPlain, draft.body.data.purchaseReturn.id);
    expect(posted.status).toBe(200);

    const payable = await payableFor(purchase.id);
    expect(payable.originalAmount.toString()).toBe('900');
    expect(payable.creditAmount.toString()).toBe('900');
    expect(payable.outstandingAmount.toString()).toBe('0');
  });

  it('prorates the discount on a partial return', async () => {
    const purchase = await postPurchase(adminPlain, ctxPlain, {
      productId: ctxPlain.productId,
      quantity: '10',
      unitCost: '100',
      discountType: 'PERCENTAGE',
      discountValue: '10',
    });
    expect(purchase.grandTotal).toBe('900.00');

    // Return 4 of 10 -> gross 400, discount 40 (40% of 100), net 360.
    const draft = await createReturn(adminPlain, {
      purchaseId: purchase.id,
      returnDate: '2026-08-30',
      items: [{ purchaseItemId: purchase.items[0].id, quantity: '4' }],
    });
    expect(draft.body.data.purchaseReturn.grandTotal).toBe('360.00');

    const posted = await postReturn(adminPlain, draft.body.data.purchaseReturn.id);
    expect(posted.status).toBe(200);

    const payable = await payableFor(purchase.id);
    // 900 owed, 360 credited back -> 540 still outstanding.
    expect(payable.creditAmount.toString()).toBe('360');
    expect(payable.outstandingAmount.toString()).toBe('540');
  });

  it('reverses the whole FIXED discount on a full return', async () => {
    // 10 @ 100 = 1000 gross, fixed 150 off -> 850 taxable.
    const purchase = await postPurchase(adminPlain, ctxPlain, {
      productId: ctxPlain.productId,
      quantity: '10',
      unitCost: '100',
      discountType: 'FIXED',
      discountValue: '150',
    });
    expect(purchase.grandTotal).toBe('850.00');

    const draft = await createReturn(adminPlain, {
      purchaseId: purchase.id,
      returnDate: '2026-08-30',
      items: [{ purchaseItemId: purchase.items[0].id, quantity: '10' }],
    });
    expect(draft.body.data.purchaseReturn.grandTotal).toBe('850.00');

    const posted = await postReturn(adminPlain, draft.body.data.purchaseReturn.id);
    expect(posted.status).toBe(200);
    const payable = await payableFor(purchase.id);
    expect(payable.outstandingAmount.toString()).toBe('0');
  });
});

describe('H1 — purchase return discount proration (GST, intra-state)', () => {
  it('reverses input GST on the NET amount, not the gross', async () => {
    // 10 @ 100 = 1000 gross, 10% discount = 100 -> 900 taxable.
    // 18% GST on 900 = 162 (CGST 81 + SGST 81). Grand total 1062.
    // The pre-fix bug taxed the gross 1000 -> 180 tax, 1180 total.
    const purchase = await postPurchase(adminGst, ctxGst, {
      productId: ctxGst.productId,
      quantity: '10',
      unitCost: '100',
      discountType: 'PERCENTAGE',
      discountValue: '10',
      taxId: ctxGst.taxId,
    });
    expect(purchase.grandTotal).toBe('1062.00');

    const draft = await createReturn(adminGst, {
      purchaseId: purchase.id,
      returnDate: '2026-08-30',
      items: [{ purchaseItemId: purchase.items[0].id, quantity: '10' }],
    });
    expect(draft.status).toBe(201);
    const r = draft.body.data.purchaseReturn;
    expect(r.taxableTotal).toBe('900.00');
    expect(r.taxTotal).toBe('162.00');
    expect(r.grandTotal).toBe('1062.00');
    expect(r.taxBreakup.cgst).toBe('81.00');
    expect(r.taxBreakup.sgst).toBe('81.00');
    expect(r.taxBreakup.igst).toBe('0.00');

    const posted = await postReturn(adminGst, r.id);
    expect(posted.status).toBe(200);

    const payable = await payableFor(purchase.id);
    expect(payable.originalAmount.toString()).toBe('1062');
    expect(payable.outstandingAmount.toString()).toBe('0');
  });

  it('prorates both the discount and the GST on a partial return', async () => {
    const purchase = await postPurchase(adminGst, ctxGst, {
      productId: ctxGst.productId,
      quantity: '10',
      unitCost: '100',
      discountType: 'PERCENTAGE',
      discountValue: '10',
      taxId: ctxGst.taxId,
    });
    expect(purchase.grandTotal).toBe('1062.00');

    // Return 5 of 10 -> gross 500, discount 50, net 450, GST 81, total 531.
    const draft = await createReturn(adminGst, {
      purchaseId: purchase.id,
      returnDate: '2026-08-30',
      items: [{ purchaseItemId: purchase.items[0].id, quantity: '5' }],
    });
    const r = draft.body.data.purchaseReturn;
    expect(r.taxableTotal).toBe('450.00');
    expect(r.taxTotal).toBe('81.00');
    expect(r.grandTotal).toBe('531.00');

    const posted = await postReturn(adminGst, r.id);
    expect(posted.status).toBe(200);
    const payable = await payableFor(purchase.id);
    expect(payable.outstandingAmount.toString()).toBe('531');
  });
});
