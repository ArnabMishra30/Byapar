import { disconnectPrisma, prisma } from '../src/config/prisma.js';
import * as authRepository from '../src/modules/auth/auth.repository.js';
import * as partyService from '../src/modules/parties/party.service.js';
import * as productService from '../src/modules/products/product.service.js';
import * as purchaseService from '../src/modules/purchases/purchase.service.js';
import * as salesService from '../src/modules/sales/sales.service.js';
import * as customerPaymentService from '../src/modules/customer-payments/customer-payment.service.js';
import { createPartySchema } from '../src/modules/parties/party.validation.js';
import { createProductSchema } from '../src/modules/products/product.validation.js';
import { createPurchaseSchema } from '../src/modules/purchases/purchase.validation.js';
import { createSaleSchema } from '../src/modules/sales/sales.validation.js';
import { createCustomerPaymentSchema } from '../src/modules/customer-payments/customer-payment.validation.js';
import { seedDemo, ACCOUNTS, PASSWORD } from './seed-demo.js';

/**
 * THE REFERENCE STATEMENT, reproduced exactly.
 *
 * Seeds the "Abdulla" party with the identical sales and payments from the
 * supplied Vyapar reference (PartyReport.pdf), and sets the shop's header to
 * "Amazing Enterprises", so the generated Party Statement is the same statement.
 *
 * GST stays OFF (no company state code), so the line amounts are the clean,
 * tax-free figures the reference shows. Everything posts through the ordinary
 * services; nothing is written to the accounting tables directly. Additive and
 * re-runnable: if "Abdulla" already exists, nothing more is added.
 *
 * Run with: npm run seed:demo:reference
 */

const MARKER_PARTY = 'Abdulla';

const draftThenPost = (service) => async (currentUser, input) => {
  const draft = await service.createDraft(currentUser, input);
  return service.post(currentUser, draft.id);
};
const postPurchase = (u, body) => draftThenPost(purchaseService)(u, createPurchaseSchema.parse(body));
const postSale = (u, body) => draftThenPost(salesService)(u, createSaleSchema.parse(body));
const postReceipt = (u, body) => draftThenPost(customerPaymentService)(u, createCustomerPaymentSchema.parse(body));

// Product keys -> the exact names on the reference.
const PRODUCTS = {
  sun: 'sun screen 100ml',
  vitc: 'Vitamin C Capsules 1000mg',
  glut500: 'Glutathione 500mg',
  glut1000: 'Glutathione capsules 1000mg',
  aloe: 'Aloe Intensive Moisturizer Lotion 200ml',
  ship: 'Shipping',
};

// Each sale: date + lines of [productKey, quantity, unitPrice]. Straight off the
// reference, in reference order.
const SALES = [
  { date: '2025-03-29', lines: [['sun', 100, 100], ['vitc', 6, 300], ['glut500', 6, 900], ['ship', 1, 200]] }, // 17,400
  { date: '2025-05-07', lines: [['glut1000', 15, 1500], ['vitc', 15, 300], ['ship', 1, 200]] }, // 27,200
  { date: '2025-05-14', lines: [['glut1000', 15, 1500], ['vitc', 11, 300], ['ship', 1, 200]] }, // 26,000
  { date: '2025-08-25', lines: [['glut1000', 5, 1500], ['vitc', 5, 300], ['ship', 1, 100]] }, // 9,100
  { date: '2025-09-03', lines: [['glut1000', 15, 1500], ['vitc', 15, 300], ['ship', 1, 100]] }, // 27,100
  { date: '2025-11-14', lines: [['sun', 1, 60], ['ship', 1, 140]] }, // 200
  { date: '2025-12-04', lines: [['glut1000', 20, 1500], ['vitc', 20, 300], ['aloe', 5, 85], ['ship', 1, 100]] }, // 36,525
  { date: '2025-12-04', lines: [['aloe', 20, 85], ['ship', 1, 100]] }, // 1,800
  { date: '2025-12-27', lines: [['sun', 30, 100], ['ship', 1, 100]] }, // 3,100
  { date: '2026-01-14', lines: [['sun', 60, 100], ['ship', 1, 100]] }, // 6,100
  { date: '2026-02-04', lines: [['glut1000', 15, 1500], ['vitc', 15, 300], ['aloe', 24, 85], ['sun', 20, 100], ['ship', 1, 100]] }, // 31,140
  { date: '2026-02-23', lines: [['vitc', 10, 300], ['ship', 1, 100]] }, // 3,100
  { date: '2026-02-25', lines: [['sun', 60, 100], ['glut1000', 10, 1500], ['ship', 1, 100]] }, // 21,100
];

// Two "Unused" (unallocated) cash advances, at their reference dates.
const PAYMENTS = [
  { date: '2025-07-25', amount: '70000' },
  { date: '2025-09-04', amount: '36800' },
];

export async function seedDemoReference() {
  // Use the existing demo shop if there is one (found by its owner, so a rename
  // does not matter); otherwise create it.
  let companyId;
  let ownerId;
  const owner = await prisma.user.findFirst({
    where: { email: ACCOUNTS.shopOwner.email },
    select: { id: true, companyId: true },
  });
  if (owner?.companyId) {
    companyId = owner.companyId;
    ownerId = owner.id;
  } else {
    const demo = await seedDemo();
    companyId = demo.company.id;
    ownerId = demo.accounts.shopOwner.id;
  }

  if (await prisma.party.findFirst({ where: { companyId, name: MARKER_PARTY } })) {
    return { created: false, companyId };
  }

  const auth = await authRepository.findAuthContextById(ownerId);
  const { isActive: _ignored, ...currentUser } = auth;

  // Header to match the reference. GST stays off (stateCode left untouched), so
  // the amounts stay the clean figures the reference prints.
  await prisma.company.update({
    where: { id: companyId },
    data: {
      name: 'Amazing Enterprises',
      registeredAddress:
        '#1253, Amazing Villa, 8th Cross BEML Layout, 5th Stage, RR Nagar, opp. New Horizon Public School',
      city: 'Bengaluru',
      pincode: '560098',
      phone: '9008216453',
      email: 'rajeshisamazing@gmail.com',
      gstin: '29BFQPR7201J1ZV',
    },
  });

  const warehouse = await prisma.warehouse.findFirst({ where: { companyId }, orderBy: { createdAt: 'asc' } });
  const unit = await prisma.unit.findFirst({ where: { companyId }, orderBy: { createdAt: 'asc' } });
  let category = await prisma.category.findFirst({ where: { companyId }, orderBy: { createdAt: 'asc' } });
  if (!category) category = await prisma.category.create({ data: { companyId, name: 'Products' } });

  // The six reference products.
  const productId = {};
  let sku = 0;
  for (const [key, name] of Object.entries(PRODUCTS)) {
    const existing = await prisma.product.findFirst({ where: { companyId, name } });
    if (existing) {
      productId[key] = existing.id;
    } else {
      const created = await productService.create(
        currentUser,
        createProductSchema.parse({ name, sku: `REF-${(sku += 1)}`, categoryId: category.id, unitId: unit.id }),
      );
      productId[key] = created.id;
    }
  }

  // Opening stock, so every sale posts. Bought once from a utility supplier at a
  // nominal cost (cost never shows on the customer statement). Comfortably more
  // than the reference ever sells.
  const stockSupplier = await partyService.create(
    currentUser,
    createPartySchema.parse({ name: 'Opening Stock Supplier', allowDuplicate: true }),
  );
  const openingQty = { sun: 400, vitc: 200, glut500: 20, glut1000: 200, aloe: 80, ship: 40 };
  await postPurchase(currentUser, {
    supplierId: stockSupplier.supplierId,
    warehouseId: warehouse.id,
    invoiceNumber: 'OPENING-STOCK',
    invoiceDate: '2025-01-01',
    items: Object.entries(openingQty).map(([key, qty]) => ({
      productId: productId[key],
      quantity: String(qty),
      unitCost: '1',
    })),
  });

  // The party - created with no type, exactly as the app now creates one.
  const abdulla = await partyService.create(
    currentUser,
    createPartySchema.parse({ name: MARKER_PARTY, phone: '9535357273', address: 'Bhatkal', allowDuplicate: true }),
  );

  for (const sale of SALES) {
    await postSale(currentUser, {
      customerId: abdulla.customerId,
      warehouseId: warehouse.id,
      invoiceDate: sale.date,
      items: sale.lines.map(([key, quantity, unitPrice]) => ({
        productId: productId[key],
        quantity: String(quantity),
        unitPrice: String(unitPrice),
      })),
    });
  }

  for (const payment of PAYMENTS) {
    await postReceipt(currentUser, {
      customerId: abdulla.customerId,
      paymentDate: payment.date,
      amount: payment.amount,
      paymentMethod: 'CASH',
      allocations: [], // unallocated advance -> "Unused", exactly like the reference
    });
  }

  return { created: true, companyId, abdullaId: abdulla.id, expectedReceivable: '103065.00' };
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('seed-demo-reference.js');

if (isDirectRun) {
  seedDemoReference()
    .then((result) => {
      console.log('');
      console.log(
        result.created
          ? 'Reference statement seeded as "Abdulla" under "Amazing Enterprises".'
          : 'Reference data already exists ("Abdulla") - nothing added.',
      );
      console.log('');
      console.log('  Sign in:  http://localhost:3002/shop/login');
      console.log(`  Email:    ${ACCOUNTS.shopOwner.email}`);
      console.log(`  Password: ${PASSWORD}`);
      if (result.abdullaId) {
        console.log('');
        console.log(`  Abdulla statement: http://localhost:3002/shop/parties/${result.abdullaId}/statement`);
        console.log('  Expected receivable: ₹1,03,065.00 (matches PartyReport.pdf)');
      }
      console.log('');
    })
    .catch((error) => {
      console.error(`Reference seed failed: ${error.message}`);
      console.error(error.stack);
      process.exitCode = 1;
    })
    .finally(async () => {
      await disconnectPrisma();
    });
}
