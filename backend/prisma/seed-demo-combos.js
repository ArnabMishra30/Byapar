import { disconnectPrisma, prisma } from '../src/config/prisma.js';
import * as authRepository from '../src/modules/auth/auth.repository.js';
import * as productService from '../src/modules/products/product.service.js';
import * as salesService from '../src/modules/sales/sales.service.js';
import * as inventoryService from '../src/modules/inventory/inventory.service.js';
import { createProductSchema } from '../src/modules/products/product.validation.js';
import { createSaleSchema } from '../src/modules/sales/sales.validation.js';
import { adjustmentSchema } from '../src/modules/inventory/inventory.validation.js';
import { seedDemo, ACCOUNTS, PASSWORD } from './seed-demo.js';

/**
 * DEMO COMBOS in the local demo shop: a saved "Diwali Pack" (1 Rice 25kg +
 * 2 Sunflower Oil 15L) and one sale of it at a changed price, so the combo,
 * its stock-out per content and the price-change trace can all be seen.
 *
 * Needs the demo parties and products (npm run seed:demo:parties). Local
 * database only. Re-running adds nothing new.
 *
 * Run with: npm run seed:demo:combos
 */
export async function seedDemoCombos() {
  const demo = await seedDemo();
  const companyId = demo.company.id;
  const { isActive: _ignored, ...owner } = await authRepository.findAuthContextById(demo.accounts.shopOwner.id);

  const existing = await prisma.product.findFirst({ where: { companyId, name: 'Diwali Pack', isCombo: true } });
  if (existing) return { created: false, comboId: existing.id };

  const [rice, oil, customer, warehouse] = await Promise.all([
    prisma.product.findFirst({ where: { companyId, name: 'Basmati Rice 25kg' } }),
    prisma.product.findFirst({ where: { companyId, name: 'Sunflower Oil 15L' } }),
    prisma.customer.findFirst({ where: { companyId, name: 'Rahul Store' } }),
    prisma.warehouse.findFirst({ where: { companyId }, orderBy: { createdAt: 'asc' } }),
  ]);
  if (!rice || !oil || !customer) {
    throw new Error('Demo products not found. Run "npm run seed:demo:parties" first.');
  }

  // Enough stock that the pack can be sold a few times.
  for (const [product, cost] of [[rice, '1200'], [oil, '1000']]) {
    await inventoryService.createAdjustment(
      owner,
      adjustmentSchema.parse({
        productId: product.id,
        warehouseId: warehouse.id,
        type: 'ADJUSTMENT_IN',
        quantity: '10',
        unitCost: cost,
        notes: 'Demo: stock for combos',
      }),
    );
  }

  const combo = await productService.create(
    owner,
    createProductSchema.parse({
      name: 'Diwali Pack',
      isCombo: true,
      sellingPrice: '4500',
      components: [
        { productId: rice.id, quantity: '1' },
        { productId: oil.id, quantity: '2' },
      ],
    }),
  );

  // One pack sold below its price: the bill shows "Price changed from 4,500".
  const draft = await salesService.createDraft(
    owner,
    createSaleSchema.parse({
      customerId: customer.id,
      warehouseId: warehouse.id,
      invoiceDate: new Date().toISOString().slice(0, 10),
      items: [{ productId: combo.id, quantity: '1', unitPrice: '4200' }],
    }),
  );
  const sale = await salesService.post(owner, draft.id);

  return { created: true, comboId: combo.id, saleId: sale.id, invoiceNumber: sale.invoiceNumber };
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('seed-demo-combos.js');

if (isDirectRun) {
  seedDemoCombos()
    .then((result) => {
      console.log('');
      console.log(result.created ? 'Demo combo "Diwali Pack" (1 Rice 25kg + 2 Sunflower Oil 15L) created.' : 'Demo combo already exists.');
      if (result.saleId) {
        console.log(`Sold once as ${result.invoiceNumber} at 4,200 instead of 4,500 (price change is recorded).`);
        console.log(`  Bill:        http://localhost:3002/shop/sales/${result.saleId}`);
      }
      console.log('  Products:    http://localhost:3002/shop/stock/products   (Diwali Pack shows "Combo - Can make N")');
      console.log('  Stock list:  http://localhost:3002/shop/stock            (two stock-outs labelled "Diwali Pack")');
      console.log(`  Sign in:     http://localhost:3002/shop/login   ${ACCOUNTS.shopOwner.email} / ${PASSWORD}`);
      console.log('');
    })
    .catch((error) => {
      console.error(`Demo combos seed failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await disconnectPrisma();
    });
}
