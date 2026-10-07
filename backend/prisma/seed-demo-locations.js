import { disconnectPrisma, prisma } from '../src/config/prisma.js';
import * as authRepository from '../src/modules/auth/auth.repository.js';
import * as locationService from '../src/modules/storage-locations/storage-location.service.js';
import * as inventoryService from '../src/modules/inventory/inventory.service.js';
import { adjustmentSchema } from '../src/modules/inventory/inventory.validation.js';
import { seedDemo, ACCOUNTS, PASSWORD, SHOP_NAME } from './seed-demo.js';

/**
 * DEMO STORAGE LOCATIONS for the local demo shop: the starter layout (Rack 1,
 * Rack 2, Counter, Drawer 1, Fridge, Back store) in its main store, the demo
 * products given a usual spot, and one stock entry tagged on a rack.
 *
 * Runs seedDemo() first, so the same safety rules apply: local database only,
 * never in production. Safe to re-run - the starter layout is idempotent and
 * the tagged stock entry is added only once.
 *
 * Run with: npm run seed:demo:locations
 */

const MARKER_NOTE = 'Demo: counted on Rack 1';

export async function seedDemoLocations() {
  const demo = await seedDemo();
  const companyId = demo.company.id;

  const auth = await authRepository.findAuthContextById(demo.accounts.shopOwner.id);
  const { isActive: _ignored, ...currentUser } = auth;

  const warehouse = await prisma.warehouse.findFirst({ where: { companyId }, orderBy: { createdAt: 'asc' } });
  const { locations } = await locationService.addStarterLocations(currentUser, warehouse.id);
  const byName = new Map(locations.map((location) => [location.name, location.id]));

  // Give the demo products a usual spot, where the party demo created them.
  const placements = [
    ['Basmati Rice 25kg', 'Rack 1'],
    ['Sunflower Oil 15L', 'Rack 2'],
  ];
  for (const [productName, locationName] of placements) {
    await prisma.product.updateMany({
      where: { companyId, name: productName, storageLocationId: null },
      data: { storageLocationId: byName.get(locationName) },
    });
  }

  let tagged = false;
  const rice = await prisma.product.findFirst({ where: { companyId, name: 'Basmati Rice 25kg' } });
  const already = await prisma.stockMovement.findFirst({ where: { companyId, notes: MARKER_NOTE } });
  if (rice && !already) {
    await inventoryService.createAdjustment(
      currentUser,
      adjustmentSchema.parse({
        productId: rice.id,
        warehouseId: warehouse.id,
        type: 'ADJUSTMENT_IN',
        quantity: '2',
        unitCost: '1200',
        notes: MARKER_NOTE,
        storageLocationId: byName.get('Rack 1'),
      }),
    );
    tagged = true;
  }

  return { warehouse, locations, tagged, hasProducts: Boolean(rice) };
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('seed-demo-locations.js');

if (isDirectRun) {
  seedDemoLocations()
    .then((result) => {
      console.log('');
      console.log(`Locations in "${result.warehouse.name}" of "${SHOP_NAME}":`);
      for (const location of result.locations) console.log(`  - ${location.name} (${location.type})`);
      if (!result.hasProducts) {
        console.log('');
        console.log('No demo products yet. Run "npm run seed:demo:parties" first to get products on racks.');
      }
      console.log('');
      console.log('  Sign in:     http://localhost:3002/shop/login');
      console.log(`  Email:       ${ACCOUNTS.shopOwner.email}`);
      console.log(`  Password:    ${PASSWORD}`);
      console.log('  Set up:      http://localhost:3002/shop/settings   ("Racks, shelves & fridges")');
      console.log('  Stock list:  http://localhost:3002/shop/stock');
      console.log('');
    })
    .catch((error) => {
      console.error(`Demo locations seed failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await disconnectPrisma();
    });
}
