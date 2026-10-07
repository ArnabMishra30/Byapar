import { disconnectPrisma, prisma } from '../src/config/prisma.js';
import * as authRepository from '../src/modules/auth/auth.repository.js';
import * as shareLinkService from '../src/modules/share-links/share-link.service.js';
import { seedDemo, ACCOUNTS, PASSWORD } from './seed-demo.js';

/**
 * DEMO SHARE LINKS for the local demo shop, so the customer's view can be
 * opened straight away:
 *   - XYZ Traders' sale invoice, with their whole account (log book);
 *   - Rahul Store's customer log book;
 *   - ABC Distributor's supplier log book.
 *
 * Needs the demo parties (npm run seed:demo:parties). Same safety checks as
 * seedDemo: local database only, never production. Re-running returns the same
 * links (sharing the same thing twice gives the same link).
 *
 * Run with: npm run seed:demo:shares
 */
export async function seedDemoShares() {
  const demo = await seedDemo();
  const companyId = demo.company.id;
  const auth = await authRepository.findAuthContextById(demo.accounts.shopOwner.id);
  const { isActive: _ignored, ...currentUser } = auth;

  const [xyz, rahul, abc] = await Promise.all([
    prisma.customer.findFirst({ where: { companyId, name: 'XYZ Traders' } }),
    prisma.customer.findFirst({ where: { companyId, name: 'Rahul Store' } }),
    prisma.supplier.findFirst({ where: { companyId, name: 'ABC Distributor' } }),
  ]);
  if (!xyz || !rahul || !abc) {
    throw new Error('Demo parties not found. Run "npm run seed:demo:parties" first.');
  }

  const xyzInvoice = await prisma.salesInvoice.findFirst({
    where: { companyId, customerId: xyz.id, status: 'POSTED' },
    orderBy: { invoiceDate: 'asc' },
  });

  const links = [];
  if (xyzInvoice) {
    const { link } = await shareLinkService.create(currentUser, {
      kind: 'INVOICE',
      salesInvoiceId: xyzInvoice.id,
      includeAccount: true,
    });
    links.push(['XYZ Traders - invoice + full account', link.token]);
  }
  const rahulLink = await shareLinkService.create(currentUser, { kind: 'CUSTOMER_ACCOUNT', customerId: rahul.id });
  links.push(['Rahul Store - customer log book', rahulLink.link.token]);
  const abcLink = await shareLinkService.create(currentUser, { kind: 'SUPPLIER_ACCOUNT', supplierId: abc.id });
  links.push(['ABC Distributor - supplier log book', abcLink.link.token]);

  return links;
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('seed-demo-shares.js');

if (isDirectRun) {
  seedDemoShares()
    .then((links) => {
      console.log('');
      console.log('Open these on any phone or browser - no login needed:');
      for (const [label, token] of links) {
        console.log(`  ${label}`);
        console.log(`    http://localhost:3002/s/${token}`);
      }
      console.log('');
      console.log('Manage them as the shop owner (Share button on a sale, customer, supplier or party page):');
      console.log(`  http://localhost:3002/shop/login   ${ACCOUNTS.shopOwner.email} / ${PASSWORD}`);
      console.log('');
    })
    .catch((error) => {
      console.error(`Demo share links seed failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await disconnectPrisma();
    });
}
