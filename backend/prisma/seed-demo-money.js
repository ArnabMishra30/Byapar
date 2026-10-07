import { disconnectPrisma, prisma } from '../src/config/prisma.js';
import * as authRepository from '../src/modules/auth/auth.repository.js';
import * as moneyAccountService from '../src/modules/money-accounts/money-account.service.js';
import * as expenseService from '../src/modules/expenses/expense.service.js';
import { seedDemo, ACCOUNTS, PASSWORD } from './seed-demo.js';

/**
 * DEMO MONEY ACCOUNTS in the local demo shop: "Cash drawer" (5,000),
 * "SBI Current" (50,000) and "PhonePe UPI" (2,000), a cash deposit into SBI,
 * one rent expense paid from SBI and one expense split cash + PhonePe.
 *
 * Local database only. Re-running adds nothing new.
 *
 * Run with: npm run seed:demo:money
 */
export async function seedDemoMoney() {
  const demo = await seedDemo();
  const companyId = demo.company.id;
  const { isActive: _ignored, ...owner } = await authRepository.findAuthContextById(demo.accounts.shopOwner.id);

  if (await prisma.account.findFirst({ where: { companyId, name: 'SBI Current' } })) return { created: false };

  const today = new Date().toISOString().slice(0, 10);
  const day = new Date(`${today}T00:00:00.000Z`);

  const drawer = await moneyAccountService.create(owner, { name: 'Cash drawer', kind: 'CASH', openingBalance: '5000', openingDate: day });
  const sbi = await moneyAccountService.create(owner, { name: 'SBI Current', kind: 'BANK', openingBalance: '50000', openingDate: day });
  const phonepe = await moneyAccountService.create(owner, { name: 'PhonePe UPI', kind: 'BANK', openingBalance: '2000', openingDate: day });

  await moneyAccountService.transfer(owner, {
    fromAccountId: drawer.id,
    toAccountId: sbi.id,
    amount: '2000',
    date: day,
    notes: 'Cash deposit',
  });

  const rent = await prisma.account.findFirst({ where: { companyId, name: 'Rent', type: 'EXPENSE' } });
  const electricity = await prisma.account.findFirst({ where: { companyId, name: 'Electricity', type: 'EXPENSE' } });

  const rentExpense = await expenseService.createDraft(owner, {
    expenseDate: day,
    expenseAccountId: rent.id,
    amount: '8000',
    paymentMode: 'BANK',
    paymentAccountId: sbi.id,
    description: 'Shop rent',
  });
  await expenseService.post(owner, rentExpense.id);

  const billExpense = await expenseService.createDraft(owner, {
    expenseDate: day,
    expenseAccountId: (electricity ?? rent).id,
    amount: '1500',
    paymentMode: 'CASH',
    paymentParts: [
      { accountId: drawer.id, amount: '1000' },
      { accountId: phonepe.id, amount: '500' },
    ],
    description: 'Electricity bill',
  });
  await expenseService.post(owner, billExpense.id);

  return { created: true, accounts: await moneyAccountService.list(owner) };
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('seed-demo-money.js');

if (isDirectRun) {
  seedDemoMoney()
    .then((result) => {
      console.log('');
      if (!result.created) {
        console.log('Demo money accounts already exist - nothing added.');
      } else {
        console.log('Money accounts and balances:');
        for (const account of result.accounts) console.log(`  ${account.name.padEnd(14)} ${account.balance}`);
        console.log('  (deposited 2,000 cash into SBI; rent 8,000 from SBI; electricity 1,000 cash + 500 PhonePe)');
      }
      console.log('');
      console.log('  Accounts:    http://localhost:3002/shop/settings      ("Cash, bank & UPI accounts")');
      console.log('  Cash & Bank: http://localhost:3002/shop/cash-bank     (balances + Transfer)');
      console.log('  Expenses:    http://localhost:3002/shop/expenses');
      console.log(`  Sign in:     http://localhost:3002/shop/login   ${ACCOUNTS.shopOwner.email} / ${PASSWORD}`);
      console.log('');
    })
    .catch((error) => {
      console.error(`Demo money seed failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await disconnectPrisma();
    });
}
