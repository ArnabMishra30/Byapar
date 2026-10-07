import { disconnectPrisma, prisma } from '../src/config/prisma.js';
import { hashPassword } from '../src/modules/auth/auth.service.js';
import * as authRepository from '../src/modules/auth/auth.repository.js';
import * as salesService from '../src/modules/sales/sales.service.js';
import * as customerPaymentService from '../src/modules/customer-payments/customer-payment.service.js';
import { createSaleSchema } from '../src/modules/sales/sales.validation.js';
import { createCustomerPaymentSchema } from '../src/modules/customer-payments/customer-payment.validation.js';
import { resolveStaffAccess } from '../src/modules/users/shop-permissions.js';
import { seedDemo, ACCOUNTS, PASSWORD } from './seed-demo.js';

/**
 * DEMO STAFF with per-user permissions, in the local demo shop: two cashiers,
 * a store keeper and an accountant, and today's bills by each cashier so the
 * Billers' day report and each cashier's "My day" have something to show.
 *
 * Needs the demo parties and products (npm run seed:demo:parties). Local
 * database only, never production. Re-running adds no duplicate users and no
 * second set of bills.
 *
 * Run with: npm run seed:demo:staff
 */

export const STAFF = [
  { email: 'cashier1@demoshop.test', name: 'Cashier One', shopRole: 'CASHIER' },
  { email: 'cashier2@demoshop.test', name: 'Cashier Two', shopRole: 'CASHIER' },
  { email: 'store@demoshop.test', name: 'Store Keeper', shopRole: 'STOREKEEPER' },
  { email: 'accounts@demoshop.test', name: 'Shop Accountant', shopRole: 'ACCOUNTANT' },
];

const MARKER = 'Demo staff bill';

async function contextFor(userId) {
  const { isActive: _ignored, ...user } = await authRepository.findAuthContextById(userId);
  return user;
}

export async function seedDemoStaff() {
  const demo = await seedDemo();
  const companyId = demo.company.id;

  const users = {};
  for (const person of STAFF) {
    let user = await prisma.user.findUnique({ where: { email: person.email } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          email: person.email,
          name: person.name,
          role: 'STAFF',
          companyId,
          passwordHash: await hashPassword(PASSWORD),
          ...resolveStaffAccess({ shopRole: person.shopRole }),
        },
      });
    }
    users[person.email] = user;
  }

  const already = await prisma.salesInvoice.findFirst({ where: { companyId, notes: MARKER } });
  const customer = await prisma.customer.findFirst({ where: { companyId, name: 'Rahul Store' } });
  const product = await prisma.product.findFirst({ where: { companyId, name: 'Basmati Rice 25kg' } });
  const warehouse = await prisma.warehouse.findFirst({ where: { companyId }, orderBy: { createdAt: 'asc' } });
  if (already || !customer || !product) return { users, billed: false };

  const today = new Date().toISOString().slice(0, 10);
  const bills = [
    ['cashier1@demoshop.test', '1500', 'CASH'],
    ['cashier1@demoshop.test', '1500', 'UPI'],
    ['cashier2@demoshop.test', '1500', 'CASH'],
  ];
  for (const [email, price, method] of bills) {
    const cashier = await contextFor(users[email].id);
    const draft = await salesService.createDraft(
      cashier,
      createSaleSchema.parse({
        customerId: customer.id,
        warehouseId: warehouse.id,
        invoiceDate: today,
        notes: MARKER,
        items: [{ productId: product.id, quantity: '1', unitPrice: price }],
      }),
    );
    const sale = await salesService.post(cashier, draft.id);
    const receivable = await prisma.customerReceivable.findFirst({ where: { salesInvoiceId: sale.id } });
    const receipt = await customerPaymentService.createDraft(
      cashier,
      createCustomerPaymentSchema.parse({
        customerId: customer.id,
        paymentDate: today,
        amount: price,
        paymentMethod: method,
        allocations: [{ receivableId: receivable.id, amount: price }],
      }),
    );
    await customerPaymentService.post(cashier, receipt.id);
  }
  return { users, billed: true };
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('seed-demo-staff.js');

if (isDirectRun) {
  seedDemoStaff()
    .then((result) => {
      console.log('');
      console.log(`Demo staff ready (password for all: ${PASSWORD})  -  http://localhost:3002/shop/login`);
      for (const person of STAFF) console.log(`  ${person.shopRole.padEnd(12)} ${person.email}`);
      console.log(`  OWNER        ${ACCOUNTS.shopOwner.email}`);
      console.log('');
      console.log(result.billed ? "Today's bills added: Cashier One x2, Cashier Two x1." : 'No new bills added.');
      console.log('Owner: Reports > Billers  (http://localhost:3002/shop/reports/billers)');
      console.log('Owner: Settings > Staff   (http://localhost:3002/shop/settings/staff)');
      console.log('');
    })
    .catch((error) => {
      console.error(`Demo staff seed failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await disconnectPrisma();
    });
}
