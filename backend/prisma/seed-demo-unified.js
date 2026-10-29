import { disconnectPrisma, prisma } from '../src/config/prisma.js';
import * as authRepository from '../src/modules/auth/auth.repository.js';
import * as partyService from '../src/modules/parties/party.service.js';
import * as categoryService from '../src/modules/categories/category.service.js';
import * as productService from '../src/modules/products/product.service.js';
import * as purchaseService from '../src/modules/purchases/purchase.service.js';
import * as salesService from '../src/modules/sales/sales.service.js';
import * as salesReturnService from '../src/modules/sales-returns/sales-return.service.js';
import * as purchaseReturnService from '../src/modules/purchase-returns/purchase-return.service.js';
import * as customerPaymentService from '../src/modules/customer-payments/customer-payment.service.js';
import * as supplierPaymentService from '../src/modules/supplier-payments/supplier-payment.service.js';
import { createPartySchema } from '../src/modules/parties/party.validation.js';
import { createCategorySchema } from '../src/modules/categories/category.validation.js';
import { createProductSchema } from '../src/modules/products/product.validation.js';
import { createPurchaseSchema } from '../src/modules/purchases/purchase.validation.js';
import { createSaleSchema } from '../src/modules/sales/sales.validation.js';
import { createSalesReturnSchema } from '../src/modules/sales-returns/sales-return.validation.js';
import { createPurchaseReturnSchema } from '../src/modules/purchase-returns/purchase-return.validation.js';
import { createCustomerPaymentSchema } from '../src/modules/customer-payments/customer-payment.validation.js';
import { createSupplierPaymentSchema } from '../src/modules/supplier-payments/supplier-payment.validation.js';
import { seedDemo, ACCOUNTS, PASSWORD, SHOP_NAME } from './seed-demo.js';

/**
 * UNIFIED-PARTY DEMO DATA for the local demo shop.
 *
 * Six parties, none of them given a "type": each is created the way the app now
 * creates one - with just a name - so the backend makes both a customer and a
 * supplier side, and every party can buy and sell. Every purchase, sale, return,
 * receipt and payment goes through the ordinary services and the same Zod
 * schemas the API uses, so stock, GST, ledgers and journal entries are exactly
 * what the app would have produced. Nothing is inserted into the accounting
 * tables directly.
 *
 * Safe to re-run on a fresh disposable database: runs seedDemo() first (local
 * database only, never production), and if "XYZ Traders" already exists it adds
 * nothing.
 *
 * Run with: npm run seed:demo:unified
 */

const MARKER_PARTY = 'XYZ Traders';

function daysAgo(n) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - n);
  return date.toISOString().slice(0, 10);
}

/** A party with NO type chosen - the backend makes it both sides for an owner. */
async function createParty(currentUser, body) {
  return partyService.create(currentUser, createPartySchema.parse({ ...body, allowDuplicate: true }));
}

const draftThenPost = (service) => async (currentUser, input) => {
  const draft = await service.createDraft(currentUser, input);
  return service.post(currentUser, draft.id);
};

const postPurchase = (u, body) => draftThenPost(purchaseService)(u, createPurchaseSchema.parse(body));
const postSale = (u, body) => draftThenPost(salesService)(u, createSaleSchema.parse(body));
const postSalesReturn = (u, body) => draftThenPost(salesReturnService)(u, createSalesReturnSchema.parse(body));
const postPurchaseReturn = (u, body) => draftThenPost(purchaseReturnService)(u, createPurchaseReturnSchema.parse(body));
const postReceipt = (u, body) => draftThenPost(customerPaymentService)(u, createCustomerPaymentSchema.parse(body));
const postSupplierPayment = (u, body) => draftThenPost(supplierPaymentService)(u, createSupplierPaymentSchema.parse(body));

export async function seedDemoUnified() {
  const demo = await seedDemo();
  const companyId = demo.company.id;

  const existing = await prisma.party.findFirst({ where: { companyId, name: MARKER_PARTY } });
  if (existing) return { created: false, demo };

  const auth = await authRepository.findAuthContextById(demo.accounts.shopOwner.id);
  const { isActive: _ignored, ...currentUser } = auth;

  const warehouse = await prisma.warehouse.findFirst({ where: { companyId }, orderBy: { createdAt: 'asc' } });
  const unit = await prisma.unit.findFirst({ where: { companyId }, orderBy: { createdAt: 'asc' } });
  const category = await categoryService.create(currentUser, createCategorySchema.parse({ name: 'Groceries' }));
  const product = (name, sku) =>
    productService.create(currentUser, createProductSchema.parse({ name, sku, categoryId: category.id, unitId: unit.id }));

  const oil = await product('Sunflower Oil 15L', 'DEMO-OIL-15');
  const rice = await product('Basmati Rice 25kg', 'DEMO-RICE-25');
  const WH = warehouse.id;

  // --- reads used to settle money against the right document -----------------
  const receivableFor = (salesInvoiceId) => prisma.customerReceivable.findFirst({ where: { companyId, salesInvoiceId } });
  const payableFor = (purchaseId) => prisma.supplierPayable.findFirst({ where: { companyId, purchaseId } });
  const saleItemFor = (salesInvoiceId, productId) =>
    prisma.salesInvoiceItem.findFirst({ where: { salesInvoiceId, productId }, select: { id: true } });
  const purchaseItemFor = (purchaseId, productId) =>
    prisma.purchaseItem.findFirst({ where: { purchaseId, productId }, select: { id: true } });

  let billNo = 1000;
  const purchase = (party, date, items) =>
    postPurchase(currentUser, { supplierId: party.supplierId, warehouseId: WH, invoiceNumber: `SB-${(billNo += 1)}`, invoiceDate: date, items });
  const sale = (party, date, items) =>
    postSale(currentUser, { customerId: party.customerId, warehouseId: WH, invoiceDate: date, items });
  const receipt = (party, date, amount, method, receivableId, extra = {}) =>
    postReceipt(currentUser, {
      customerId: party.customerId,
      paymentDate: date,
      amount,
      paymentMethod: method,
      allocations: receivableId ? [{ receivableId, amount }] : [],
      ...extra,
    });
  const payOut = (party, date, amount, method, payableId, extra = {}) =>
    postSupplierPayment(currentUser, {
      supplierId: party.supplierId,
      paymentDate: date,
      amount,
      paymentMethod: method,
      allocations: payableId ? [{ payableId, amount }] : [],
      ...extra,
    });

  // === the six parties (no type chosen) =====================================
  const A = await createParty(currentUser, { name: MARKER_PARTY, phone: '9800000003', email: 'accounts@xyztraders.test', contactPerson: 'Mr. Verma', address: '14 Market Yard', city: 'Pune' });
  const B = await createParty(currentUser, { name: 'Rahul Store', phone: '9800000001', city: 'Pune' });
  const C = await createParty(currentUser, { name: 'ABC Distributors', phone: '9800000002', contactPerson: 'Anil Bhosale', city: 'Pune' });
  const D = await createParty(currentUser, { name: 'Sharma Traders', phone: '9800000004', city: 'Nagpur' });
  const E = await createParty(currentUser, { name: 'New Party', phone: '9800000005' });
  const F = await createParty(currentUser, { name: 'Mixed Traders', phone: '9800000006', email: 'books@mixedtraders.test', address: 'Plot 9, MIDC', city: 'Nashik' });

  // === purchases first, so every later sale has stock ========================
  const aPur = await purchase(A, daysAgo(40), [{ productId: oil.id, quantity: '20', unitCost: '1000' }]); // 20,000
  const bPur = await purchase(B, daysAgo(38), [{ productId: rice.id, quantity: '4', unitCost: '1000' }]); // 4,000
  const cPur1 = await purchase(C, daysAgo(45), [{ productId: rice.id, quantity: '30', unitCost: '1000' }]); // 30,000
  const cPur2 = await purchase(C, daysAgo(35), [{ productId: oil.id, quantity: '15', unitCost: '1000' }]); // 15,000
  const dPur = await purchase(D, daysAgo(20), [{ productId: rice.id, quantity: '4', unitCost: '1000' }]); // 4,000
  const fPur1 = await purchase(F, daysAgo(60), [{ productId: oil.id, quantity: '50', unitCost: '1000' }]); // 50,000
  const fPur2 = await purchase(F, daysAgo(58), [{ productId: rice.id, quantity: '40', unitCost: '1000' }]); // 40,000

  // === sales =================================================================
  const aSale = await sale(A, daysAgo(30), [{ productId: oil.id, quantity: '4', unitPrice: '2000' }]); // 8,000
  const bSale = await sale(B, daysAgo(28), [{ productId: rice.id, quantity: '8', unitPrice: '1500' }]); // 12,000
  const cSale = await sale(C, daysAgo(25), [{ productId: oil.id, quantity: '5', unitPrice: '2000' }]); // 10,000
  const dSale = await sale(D, daysAgo(15), [{ productId: rice.id, quantity: '4', unitPrice: '1500' }]); // 6,000

  const f1 = await sale(F, daysAgo(55), [{ productId: oil.id, quantity: '10', unitPrice: '2000' }]); // 20,000
  const f2 = await sale(F, daysAgo(50), [{ productId: rice.id, quantity: '12', unitPrice: '1500' }]); // 18,000
  const f3 = await sale(F, daysAgo(45), [{ productId: oil.id, quantity: '5', unitPrice: '2000' }]); // 10,000
  const f4 = await sale(F, daysAgo(40), [{ productId: rice.id, quantity: '8', unitPrice: '1500' }]); // 12,000
  const f5 = await sale(F, daysAgo(35), [{ productId: oil.id, quantity: '6', unitPrice: '2000' }]); // 12,000
  const f6 = await sale(F, daysAgo(30), [{ productId: rice.id, quantity: '4', unitPrice: '1500' }]); // 6,000
  const f7 = await sale(F, daysAgo(20), [{ productId: oil.id, quantity: '3', unitPrice: '2000' }]); // 6,000
  const f8 = await sale(F, daysAgo(10), [{ productId: rice.id, quantity: '10', unitPrice: '1500' }]); // 15,000

  // === returns (adjust the right side, never the other) ======================
  const f2RiceItem = await saleItemFor(f2.id, rice.id);
  await postSalesReturn(currentUser, { salesInvoiceId: f2.id, returnDate: daysAgo(42), items: [{ salesInvoiceItemId: f2RiceItem.id, quantity: '2' }] }); // -3,000 receivable
  const fPur1OilItem = await purchaseItemFor(fPur1.id, oil.id);
  await postPurchaseReturn(currentUser, { purchaseId: fPur1.id, returnDate: daysAgo(52), items: [{ purchaseItemId: fPur1OilItem.id, quantity: '3' }] }); // -3,000 payable

  // === receipts (money in) and supplier payments (money out) =================
  // A: receivable 8,000 - 2,000 = 6,000 ; payable 20,000 - 5,000 = 15,000
  await receipt(A, daysAgo(24), '2000', 'CASH', (await receivableFor(aSale.id)).id);
  await payOut(A, daysAgo(22), '5000', 'UPI', (await payableFor(aPur.id)).id);

  // B: receivable 12,000 - 3,500 = 8,500 ; payable 4,000 - 1,000 = 3,000
  await receipt(B, daysAgo(20), '3500', 'CASH', (await receivableFor(bSale.id)).id);
  await payOut(B, daysAgo(18), '1000', 'BANK_TRANSFER', (await payableFor(bPur.id)).id);

  // C: receivable 10,000 (unpaid) ; payable 45,000 - 20,000 = 25,000
  await payOut(C, daysAgo(15), '20000', 'BANK_TRANSFER', (await payableFor(cPur1.id)).id);

  // D: both settled to zero
  await receipt(D, daysAgo(10), '6000', 'CASH', (await receivableFor(dSale.id)).id);
  await payOut(D, daysAgo(8), '4000', 'UPI', (await payableFor(dPur.id)).id);

  // F: partial money both ways, different methods
  await receipt(F, daysAgo(48), '20000', 'CASH', (await receivableFor(f1.id)).id);
  await receipt(F, daysAgo(38), '10000', 'UPI', (await receivableFor(f2.id)).id); // f2 now 15,000 after return
  await receipt(F, daysAgo(15), '5000', 'BANK', (await receivableFor(f3.id)).id);
  await payOut(F, daysAgo(40), '40000', 'BANK_TRANSFER', (await payableFor(fPur1.id)).id);

  return {
    created: true,
    demo,
    parties: { A: A.id, B: B.id, C: C.id, D: D.id, E: E.id, F: F.id },
    expected: {
      'XYZ Traders': { receivable: '6000.00', payable: '15000.00' },
      'Rahul Store': { receivable: '8500.00', payable: '3000.00' },
      'ABC Distributors': { receivable: '10000.00', payable: '25000.00' },
      'Sharma Traders': { receivable: '0.00', payable: '0.00' },
      'New Party': { receivable: '0.00', payable: '0.00' },
      'Mixed Traders': { receivable: '61000.00', payable: '47000.00' },
    },
  };
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('seed-demo-unified.js');

if (isDirectRun) {
  seedDemoUnified()
    .then((result) => {
      console.log('');
      console.log(
        result.created
          ? `Unified demo data added to "${SHOP_NAME}".`
          : `Unified demo data already exists in "${SHOP_NAME}" - nothing added.`,
      );
      console.log('');
      console.log('  Sign in:   http://localhost:3002/shop/login');
      console.log(`  Email:     ${ACCOUNTS.shopOwner.email}   (staff: ${ACCOUNTS.shopStaff.email})`);
      console.log(`  Password:  ${PASSWORD}`);
      console.log('  Parties:   http://localhost:3002/shop/parties');
      if (result.parties) {
        console.log('');
        for (const [key, id] of Object.entries(result.parties)) {
          console.log(`  ${key}: http://localhost:3002/shop/parties/${id}/statement`);
        }
      }
      console.log('');
    })
    .catch((error) => {
      console.error(`Unified demo seed failed: ${error.message}`);
      console.error(error.stack);
      process.exitCode = 1;
    })
    .finally(async () => {
      await disconnectPrisma();
    });
}
