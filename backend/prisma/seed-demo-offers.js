import { disconnectPrisma, prisma } from '../src/config/prisma.js';
import * as authRepository from '../src/modules/auth/auth.repository.js';
import * as offerService from '../src/modules/offers/offer.service.js';
import * as salesService from '../src/modules/sales/sales.service.js';
import { createSaleSchema } from '../src/modules/sales/sales.validation.js';
import { seedDemo, ACCOUNTS, PASSWORD } from './seed-demo.js';

/**
 * DEMO OFFERS in the local demo shop: "Buy 2 Rice 25kg, get 1 Rice 25kg free"
 * and "Buy 1 Sunflower Oil 15L, get 1 Basmati Rice 25kg free" (running for 30
 * days), plus one sale where the free rice was added automatically.
 *
 * Needs the demo products (npm run seed:demo:parties). Local database only.
 * Re-running adds nothing new.
 *
 * Run with: npm run seed:demo:offers
 */
export async function seedDemoOffers() {
  const demo = await seedDemo();
  const companyId = demo.company.id;
  const { isActive: _ignored, ...owner } = await authRepository.findAuthContextById(demo.accounts.shopOwner.id);

  if (await prisma.offer.findFirst({ where: { companyId } })) return { created: false };

  const [rice, oil, customer, warehouse] = await Promise.all([
    prisma.product.findFirst({ where: { companyId, name: 'Basmati Rice 25kg' } }),
    prisma.product.findFirst({ where: { companyId, name: 'Sunflower Oil 15L' } }),
    prisma.customer.findFirst({ where: { companyId, name: 'Rahul Store' } }),
    prisma.warehouse.findFirst({ where: { companyId }, orderBy: { createdAt: 'asc' } }),
  ]);
  if (!rice || !oil || !customer) throw new Error('Demo products not found. Run "npm run seed:demo:parties" first.');

  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const day = (value) => new Date(`${value}T00:00:00.000Z`);

  const b2g1 = await offerService.create(owner, {
    buyProductId: rice.id,
    buyQuantity: '2',
    freeProductId: rice.id,
    freeQuantity: '1',
  });
  await offerService.create(owner, {
    buyProductId: oil.id,
    buyQuantity: '1',
    freeProductId: rice.id,
    freeQuantity: '1',
    startDate: day(today),
    endDate: day(in30),
  });

  // Two rice sold: the server adds the third, free.
  const draft = await salesService.createDraft(
    owner,
    createSaleSchema.parse({
      customerId: customer.id,
      warehouseId: warehouse.id,
      invoiceDate: today,
      items: [{ productId: rice.id, quantity: '2', unitPrice: '1500' }],
    }),
  );
  const sale = await salesService.post(owner, draft.id);

  return { created: true, offer: b2g1.name, saleId: sale.id, invoiceNumber: sale.invoiceNumber };
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('seed-demo-offers.js');

if (isDirectRun) {
  seedDemoOffers()
    .then((result) => {
      console.log('');
      if (!result.created) {
        console.log('Demo offers already exist - nothing added.');
      } else {
        console.log(`Offers created. "${result.offer}" applied on ${result.invoiceNumber} (2 paid + 1 free rice).`);
        console.log(`  Bill:          http://localhost:3002/shop/sales/${result.saleId}`);
      }
      console.log('  Offers:        http://localhost:3002/shop/stock/offers');
      console.log('  Offers report: http://localhost:3002/shop/reports/offers');
      console.log(`  Sign in:       http://localhost:3002/shop/login   ${ACCOUNTS.shopOwner.email} / ${PASSWORD}`);
      console.log('');
    })
    .catch((error) => {
      console.error(`Demo offers seed failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await disconnectPrisma();
    });
}
