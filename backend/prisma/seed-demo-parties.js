import { disconnectPrisma, prisma } from '../src/config/prisma.js';
import * as authRepository from '../src/modules/auth/auth.repository.js';
import * as partyService from '../src/modules/parties/party.service.js';
import * as categoryService from '../src/modules/categories/category.service.js';
import * as productService from '../src/modules/products/product.service.js';
import * as purchaseService from '../src/modules/purchases/purchase.service.js';
import * as salesService from '../src/modules/sales/sales.service.js';
import * as customerPaymentService from '../src/modules/customer-payments/customer-payment.service.js';
import * as supplierService from '../src/modules/suppliers/supplier.service.js';
import * as supplierPaymentService from '../src/modules/supplier-payments/supplier-payment.service.js';
import { createPartySchema } from '../src/modules/parties/party.validation.js';
import { createCategorySchema } from '../src/modules/categories/category.validation.js';
import { createProductSchema } from '../src/modules/products/product.validation.js';
import { createPurchaseSchema } from '../src/modules/purchases/purchase.validation.js';
import { createSaleSchema } from '../src/modules/sales/sales.validation.js';
import { createCustomerPaymentSchema } from '../src/modules/customer-payments/customer-payment.validation.js';
import { createSupplierSchema } from '../src/modules/suppliers/supplier.validation.js';
import { createSupplierPaymentSchema } from '../src/modules/supplier-payments/supplier-payment.validation.js';
import { seedDemo, ACCOUNTS, PASSWORD, SHOP_NAME } from './seed-demo.js';

/**
 * DEMO PARTIES for the local demo shop: a customer, a supplier, and a party
 * that is BOTH, with real posted purchases, sales and payments behind them.
 *
 * Everything goes through the ordinary services and the same Zod schemas the
 * API uses, so the ledgers, stock and journal entries are exactly what the app
 * would have produced had somebody typed it all in. Nothing is written to the
 * accounting tables directly.
 *
 * Runs seedDemo() first (same safety checks: local database only, never in
 * production), then adds the parties once. Re-running is safe: if the demo
 * shop already has "XYZ Traders", nothing more is added.
 *
 * Run with: npm run seed:demo:parties
 */

const MARKER_PARTY = 'XYZ Traders';

function daysAgo(n) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - n);
  return date.toISOString().slice(0, 10);
}

async function createParty(currentUser, body) {
  return partyService.create(currentUser, createPartySchema.parse({ ...body, allowDuplicate: true }));
}

async function postPurchase(currentUser, body) {
  const draft = await purchaseService.createDraft(currentUser, createPurchaseSchema.parse(body));
  return purchaseService.post(currentUser, draft.id);
}

async function postSale(currentUser, body) {
  const draft = await salesService.createDraft(currentUser, createSaleSchema.parse(body));
  return salesService.post(currentUser, draft.id);
}

async function postReceipt(currentUser, body) {
  const draft = await customerPaymentService.createDraft(currentUser, createCustomerPaymentSchema.parse(body));
  return customerPaymentService.post(currentUser, draft.id);
}

async function postSupplierPayment(currentUser, body) {
  const draft = await supplierPaymentService.createDraft(currentUser, createSupplierPaymentSchema.parse(body));
  return supplierPaymentService.post(currentUser, draft.id);
}

export async function seedDemoParties() {
  const demo = await seedDemo();
  const companyId = demo.company.id;

  const existing = await prisma.party.findFirst({ where: { companyId, name: MARKER_PARTY } });
  if (existing) return { created: false, demo };

  const auth = await authRepository.findAuthContextById(demo.accounts.shopOwner.id);
  const { isActive: _ignored, ...currentUser } = auth;

  // --- what the shop stocks -------------------------------------------------
  const unit = await prisma.unit.findFirst({ where: { companyId }, orderBy: { createdAt: 'asc' } });
  const warehouse = await prisma.warehouse.findFirst({ where: { companyId }, orderBy: { createdAt: 'asc' } });
  const category = await categoryService.create(currentUser, createCategorySchema.parse({ name: 'Groceries' }));

  const rice = await productService.create(
    currentUser,
    createProductSchema.parse({ name: 'Basmati Rice 25kg', sku: 'DEMO-RICE-25', categoryId: category.id, unitId: unit.id }),
  );
  const oil = await productService.create(
    currentUser,
    createProductSchema.parse({ name: 'Sunflower Oil 15L', sku: 'DEMO-OIL-15', categoryId: category.id, unitId: unit.id }),
  );

  // --- the parties ----------------------------------------------------------
  const rahul = await createParty(currentUser, {
    name: 'Rahul Store',
    phone: '9800000001',
    city: 'Pune',
    relationship: 'CUSTOMER',
    customer: { creditDays: 7 },
  });
  const abc = await createParty(currentUser, {
    name: 'ABC Distributor',
    phone: '9800000002',
    contactPerson: 'Anil Bhosale',
    city: 'Pune',
    relationship: 'SUPPLIER',
    supplier: { creditDays: 30 },
  });
  const xyz = await createParty(currentUser, {
    name: MARKER_PARTY,
    phone: '9800000003',
    email: 'accounts@xyztraders.test',
    contactPerson: 'Mr. Verma',
    address: '14 Market Yard',
    city: 'Pune',
    relationship: 'BOTH',
    customer: { creditDays: 15 },
    supplier: { creditDays: 30 },
  });
  await createParty(currentUser, {
    name: 'Sharma Traders',
    phone: '9800000004',
    relationship: 'CUSTOMER',
  });

  // --- what happened with them ---------------------------------------------
  // We buy rice from ABC and oil from XYZ; we sell rice to Rahul and oil to XYZ.
  // Dates are relative to today so some bills are genuinely overdue.
  const abcPurchase = await postPurchase(currentUser, {
    supplierId: abc.supplierId,
    warehouseId: warehouse.id,
    invoiceNumber: 'ABC-1041',
    invoiceDate: daysAgo(40),
    dueDate: daysAgo(10),
    items: [{ productId: rice.id, quantity: '50', unitCost: '1200' }],
  });

  const xyzPurchase = await postPurchase(currentUser, {
    supplierId: xyz.supplierId,
    warehouseId: warehouse.id,
    invoiceNumber: 'XYZ-889',
    invoiceDate: daysAgo(20),
    dueDate: daysAgo(5),
    items: [{ productId: oil.id, quantity: '20', unitCost: '1000' }],
  });

  const xyzSale = await postSale(currentUser, {
    customerId: xyz.customerId,
    warehouseId: warehouse.id,
    invoiceDate: daysAgo(12),
    dueDate: daysAgo(2),
    items: [{ productId: oil.id, quantity: '4', unitPrice: '2000' }],
  });

  const rahulSale = await postSale(currentUser, {
    customerId: rahul.customerId,
    warehouseId: warehouse.id,
    invoiceDate: daysAgo(3),
    items: [{ productId: rice.id, quantity: '10', unitPrice: '1500' }],
  });

  // Money: each side settled on its own. Nothing nets XYZ's two balances.
  const receivableFor = (salesInvoiceId) =>
    prisma.customerReceivable.findFirst({ where: { companyId, salesInvoiceId } });
  const payableFor = (purchaseId) => prisma.supplierPayable.findFirst({ where: { companyId, purchaseId } });

  const xyzReceivable = await receivableFor(xyzSale.id);
  await postReceipt(currentUser, {
    customerId: xyz.customerId,
    paymentDate: daysAgo(6),
    amount: '2000',
    paymentMethod: 'UPI',
    allocations: [{ receivableId: xyzReceivable.id, amount: '2000' }],
  });

  const rahulReceivable = await receivableFor(rahulSale.id);
  await postReceipt(currentUser, {
    customerId: rahul.customerId,
    paymentDate: daysAgo(1),
    amount: '5000',
    paymentMethod: 'CASH',
    allocations: [{ receivableId: rahulReceivable.id, amount: '5000' }],
  });

  const xyzPayable = await payableFor(xyzPurchase.id);
  await postSupplierPayment(currentUser, {
    supplierId: xyz.supplierId,
    paymentDate: daysAgo(4),
    amount: '5000',
    paymentMethod: 'BANK_TRANSFER',
    allocations: [{ payableId: xyzPayable.id, amount: '5000' }],
  });

  const abcPayable = await payableFor(abcPurchase.id);
  await postSupplierPayment(currentUser, {
    supplierId: abc.supplierId,
    paymentDate: daysAgo(15),
    amount: '20000',
    paymentMethod: 'BANK_TRANSFER',
    allocations: [{ payableId: abcPayable.id, amount: '20000' }],
  });

  // A customer and a supplier record for the same business, added separately
  // before the party master existed - the case "Link the record" is for.
  // Deliberately a separate supplier record (its own party), for trying
  // "Already a supplier? Link the record" on Sharma Traders' profile.
  await supplierService.create(
    currentUser,
    createSupplierSchema.parse({ name: 'Sharma Traders Wholesale', phone: '9800000044' }),
  );

  return { created: true, demo, xyzId: xyz.id };
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('seed-demo-parties.js');

if (isDirectRun) {
  seedDemoParties()
    .then((result) => {
      console.log('');
      console.log(
        result.created
          ? `Demo parties added to "${SHOP_NAME}".`
          : `Demo parties already exist in "${SHOP_NAME}" - nothing added.`,
      );
      console.log('');
      console.log('  Sign in:   http://localhost:3002/shop/login');
      console.log(`  Email:     ${ACCOUNTS.shopOwner.email}   (staff: ${ACCOUNTS.shopStaff.email})`);
      console.log(`  Password:  ${PASSWORD}`);
      console.log('');
      console.log('  Parties:   http://localhost:3002/shop/parties');
      console.log('  Add party: http://localhost:3002/shop/parties/new');
      console.log('');
      console.log('  XYZ Traders is both: owes you 6,000 and you owe them 15,000 - shown separately.');
      console.log('');
    })
    .catch((error) => {
      console.error(`Demo parties seed failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await disconnectPrisma();
    });
}
