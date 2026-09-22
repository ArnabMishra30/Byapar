import { ApiError } from '../../utils/api-error.js';
import { add, subtract, round, toDecimal, toMoneyString, isGreaterThan, isZero } from '../../utils/money.js';
import { withRetryableTransaction } from '../../config/transaction.js';
import * as openingBalanceRepository from './opening-balance.repository.js';
import * as accountRepository from '../accounting/account.repository.js';
import * as customerReceivableRepository from '../customer-receivables/customer-receivable.repository.js';
import * as customerLedgerRepository from '../customer-receivables/customer-ledger.repository.js';
import * as supplierPayableRepository from '../supplier-payables/supplier-payable.repository.js';
import * as supplierLedgerRepository from '../supplier-payables/supplier-ledger.repository.js';
import * as inventoryService from '../inventory/inventory.service.js';
import { REFERENCE_TYPE as INVENTORY_REFERENCE_TYPE } from '../inventory/inventory.service.js';
import { LEDGER_REFERENCE_TYPE as CUSTOMER_REFERENCE_TYPE } from '../customer-receivables/customer-receivable.service.js';
import { LEDGER_REFERENCE_TYPE as SUPPLIER_REFERENCE_TYPE } from '../supplier-payables/supplier-payable.service.js';
import { SOURCE_TYPE, createPostedEntryWithinTransaction } from '../accounting/journal.service.js';
import { SYSTEM_ACCOUNT } from '../accounting/system-accounts.js';

// OPENING BALANCES - how a business that already exists starts using this system.
//
// A shop with ₹50,000 in the till, ₹2,00,000 of stock and customers who owe it
// money did not acquire any of that here. Recording it as sales, purchases or
// receipts would be a lie that shows up immediately: revenue that never
// happened, profit that was never earned.
//
// So opening balances are an INITIALIZATION, not a transaction. One balanced
// journal entry against Owner's Capital, plus real rows in the sub-ledgers and
// the inventory module that already own those questions.
//
// THREE RULES THAT SHAPE EVERYTHING BELOW:
//
//   1. NO FAKE DOCUMENTS. There is no opening invoice, no opening purchase and
//      no opening expense. A customer's opening due is a receivable with NO
//      salesInvoiceId, and a ledger entry typed OPENING_BALANCE. That is why the
//      FK was relaxed to nullable rather than filled with an invented invoice.
//
//   2. ONE INITIALIZATION PER COMPANY, ENFORCED BY THE DATABASE. The opening
//      journal is stored as sourceType OPENING_BALANCE with the COMPANY'S OWN ID
//      as sourceId. The existing @@unique([companyId, sourceType, sourceId]) on
//      JournalEntry therefore makes a second initialization impossible - not
//      merely guarded against in code, and not defeatable by two simultaneous
//      requests.
//
//   3. NOTHING NEW CALCULATES A BALANCE. Cash and bank come out of the GL,
//      customer dues out of the customer sub-ledger, supplier dues out of the
//      supplier sub-ledger, stock out of the inventory module at its own moving
//      average. Every report reads them where it always did.
//
// GST IS NOT INVOLVED. No GSTIN, no HSN, no place of supply, no tax rate, no
// state code. A shop with no registration initializes exactly as a registered
// company does.

const MONEY_DP = 4;
const QUANTITY_DP = 6;
const DISPLAY_DP = 2;

const money = (value) => toMoneyString(value ?? 0, DISPLAY_DP);

function toDateString(value) {
  return value ? value.toISOString().slice(0, 10) : null;
}

// --- validation ------------------------------------------------------------

/** Every amount an opening balance carries must be a real, positive figure. */
function assertPositive(amount, label) {
  if (!isGreaterThan(amount, 0)) {
    throw ApiError.business(422, 'INVALID_OPENING_AMOUNT', `${label} must be more than zero`);
  }
}

/**
 * Loads and checks the parties and products an initialization refers to.
 *
 * Everything is company scoped, so an id belonging to another company is
 * reported exactly like one that does not exist.
 */
async function loadAndValidateReferences(companyId, input) {
  const customerIds = (input.customers ?? []).map((row) => row.customerId);
  const supplierIds = (input.suppliers ?? []).map((row) => row.supplierId);
  const productIds = (input.inventory ?? []).map((row) => row.productId);
  const warehouseIds = [...new Set((input.inventory ?? []).map((row) => row.warehouseId))];
  const bankAccountIds = (input.bankAccounts ?? [])
    .map((row) => row.accountId)
    .filter(Boolean);
  const otherAccountIds = (input.otherBalances ?? []).map((row) => row.accountId);

  const duplicate = (ids, label) => {
    if (new Set(ids).size !== ids.length) {
      throw ApiError.business(
        422,
        'DUPLICATE_OPENING_ENTRY',
        `${label} appears more than once. Give each one a single opening balance.`,
      );
    }
  };

  duplicate(customerIds, 'A customer');
  duplicate(supplierIds, 'A supplier');
  // A product may legitimately appear once per warehouse, so the pair is the key.
  duplicate(
    (input.inventory ?? []).map((row) => `${row.productId}:${row.warehouseId}`),
    'A product and warehouse pair',
  );
  duplicate(bankAccountIds, 'A bank account');
  duplicate(otherAccountIds, 'An account in other balances');

  // The same account cannot be named as both a bank balance and an "other"
  // balance - it would be counted twice in the same entry.
  const overlap = otherAccountIds.filter((id) => bankAccountIds.includes(id));
  if (overlap.length > 0) {
    throw ApiError.business(
      422,
      'DUPLICATE_OPENING_ENTRY',
      'An account appears as both a bank balance and an other balance. Give it one opening balance.',
    );
  }

  const [customers, suppliers, products, warehouses, bankAccounts, otherAccounts] =
    await Promise.all([
      openingBalanceRepository.findCustomersByIds(companyId, customerIds),
      openingBalanceRepository.findSuppliersByIds(companyId, supplierIds),
      openingBalanceRepository.findProductsByIds(companyId, productIds),
      openingBalanceRepository.findWarehousesByIds(companyId, warehouseIds),
      openingBalanceRepository.findAccountsByIds(companyId, bankAccountIds),
      openingBalanceRepository.findAccountsByIds(companyId, otherAccountIds),
    ]);

  const requireAll = (found, requested, code, label) => {
    const byId = new Map(found.map((row) => [row.id, row]));
    for (const id of requested) {
      if (!byId.has(id)) {
        throw ApiError.business(404, code, `${label} in the opening balances was not found`);
      }
    }
    return byId;
  };

  const customerById = requireAll(customers, customerIds, 'CUSTOMER_NOT_FOUND', 'A customer');
  const supplierById = requireAll(suppliers, supplierIds, 'SUPPLIER_NOT_FOUND', 'A supplier');
  const productById = requireAll(products, productIds, 'PRODUCT_NOT_FOUND', 'A product');
  const warehouseById = requireAll(warehouses, warehouseIds, 'WAREHOUSE_NOT_FOUND', 'A warehouse');
  const accountById = requireAll(
    bankAccounts,
    bankAccountIds,
    'ACCOUNT_NOT_FOUND',
    'A bank account',
  );

  // A named bank account must be somewhere money can actually sit.
  for (const account of accountById.values()) {
    if (account.type !== 'ASSET') {
      throw ApiError.business(
        422,
        'INVALID_OPENING_ACCOUNT',
        `${account.code} ${account.name} is a ${account.type} account. An opening bank balance must sit in an ASSET account.`,
      );
    }
    if (!account.isActive) {
      throw ApiError.business(
        422,
        'ACCOUNT_INACTIVE',
        `Account ${account.code} ${account.name} is inactive`,
      );
    }
  }

  const otherAccountById = requireAll(
    otherAccounts,
    otherAccountIds,
    'ACCOUNT_NOT_FOUND',
    'An account',
  );

  // WHAT MAY CARRY AN OPENING BALANCE, and what may not.
  //
  // ASSET, LIABILITY and EQUITY are things a business HAS on the day it starts
  // using this system: a vehicle, a loan, capital already introduced.
  //
  // REVENUE and EXPENSE are refused outright. They describe what happened DURING
  // a period, and an opening balance describes a position at a moment. Allowing
  // them would let an initialization manufacture profit that was never earned -
  // the one thing this whole module exists to avoid.
  const CONTROLLED = new Map([
    [SYSTEM_ACCOUNT.CASH, 'cash'],
    [SYSTEM_ACCOUNT.INVENTORY, 'inventory'],
    [SYSTEM_ACCOUNT.ACCOUNTS_RECEIVABLE, 'customers'],
    [SYSTEM_ACCOUNT.ACCOUNTS_PAYABLE, 'suppliers'],
  ]);

  for (const account of otherAccountById.values()) {
    if (!['ASSET', 'LIABILITY', 'EQUITY'].includes(account.type)) {
      throw ApiError.business(
        422,
        'INVALID_OPENING_ACCOUNT',
        `${account.code} ${account.name} is a ${account.type} account. An opening balance can only be set on an ASSET, LIABILITY or EQUITY account - revenue and expenses describe a period, not a starting position.`,
      );
    }

    if (!account.isActive) {
      throw ApiError.business(
        422,
        'ACCOUNT_INACTIVE',
        `Account ${account.code} ${account.name} is inactive`,
      );
    }

    // The control accounts are driven by their own dedicated fields. Setting one
    // here as well would double-count it and break the sub-ledger reconciliation
    // the rest of this module guarantees.
    const field = CONTROLLED.get(account.code);
    if (field) {
      throw ApiError.business(
        422,
        'CONTROLLED_OPENING_ACCOUNT',
        `${account.code} ${account.name} is maintained by the "${field}" field. Set it there rather than as an other balance, or it would be counted twice.`,
      );
    }
  }

  return { customerById, supplierById, productById, warehouseById, accountById, otherAccountById };
}

// --- the arithmetic, pure and testable -------------------------------------

/**
 * The opening journal, as debit and credit totals per account, before any
 * database is involved.
 *
 * Exported and dependency-free so the balancing rule can be unit tested exactly
 * the way `buildExpenseLines` and `deriveCreditPosition` are.
 *
 *   Dr Cash / Bank / Inventory / Accounts Receivable
 *       Cr Accounts Payable
 *       Cr Owner's Capital        <- the balancing figure, whichever way it falls
 *
 * Owner's Capital is NOT a plug that hides an error. It is the real accounting
 * answer: what the owner has put into the business is exactly its assets less
 * its liabilities. If liabilities exceed assets the entry reverses and capital
 * is debited, which is equally correct and equally balanced.
 */
export function buildOpeningLines({
  cash = 0,
  bankByAccountId = [],
  inventoryValue = 0,
  receivableTotal = 0,
  payableTotal = 0,
  /**
   * Anything else the business already owns or owes, as
   * { accountId, accountCode, type, amount, description }.
   *
   * The SIDE IS DERIVED FROM THE ACCOUNT TYPE, never supplied by the caller: an
   * asset opens as a debit and a liability or equity as a credit, whatever
   * anybody believes. Trusting a caller-supplied side would let a mistake turn a
   * loan into an asset and still balance.
   */
  otherLines = [],
  asOfDate,
}) {
  const label = `Opening balances as at ${toDateString(asOfDate) ?? 'the start date'}`;
  const debits = [];
  const credits = [];

  const push = (target, line) => {
    if (!isZero(toDecimal(line.debit ?? line.credit ?? 0))) target.push(line);
  };

  push(debits, {
    accountCode: SYSTEM_ACCOUNT.CASH,
    debit: round(cash, MONEY_DP),
    description: `Opening cash - ${label}`,
  });

  // Each named bank account gets its own line, so a business with three banks
  // sees three balances rather than one meaningless total.
  for (const bank of bankByAccountId) {
    push(debits, {
      accountId: bank.accountId,
      accountCode: bank.accountCode,
      debit: round(bank.amount, MONEY_DP),
      description: `Opening bank balance - ${label}`,
    });
  }

  push(debits, {
    accountCode: SYSTEM_ACCOUNT.INVENTORY,
    debit: round(inventoryValue, MONEY_DP),
    description: `Opening stock - ${label}`,
  });

  push(debits, {
    accountCode: SYSTEM_ACCOUNT.ACCOUNTS_RECEIVABLE,
    debit: round(receivableTotal, MONEY_DP),
    description: `Opening customer dues - ${label}`,
  });

  push(credits, {
    accountCode: SYSTEM_ACCOUNT.ACCOUNTS_PAYABLE,
    credit: round(payableTotal, MONEY_DP),
    description: `Opening supplier dues - ${label}`,
  });

  for (const other of otherLines) {
    const amount = round(other.amount, MONEY_DP);
    const description = other.description
      ? `${other.description} - ${label}`
      : `Opening balance - ${label}`;

    if (other.type === 'ASSET') {
      push(debits, { accountId: other.accountId, accountCode: other.accountCode, debit: amount, description });
    } else {
      // LIABILITY and EQUITY are credit-normal. Nothing else reaches here -
      // loadAndValidateReferences refuses revenue and expense accounts.
      push(credits, { accountId: other.accountId, accountCode: other.accountCode, credit: amount, description });
    }
  }

  const totalDebit = debits.reduce((total, line) => add(total, line.debit), toDecimal(0));
  const totalCredit = credits.reduce((total, line) => add(total, line.credit), toDecimal(0));
  const capital = subtract(totalDebit, totalCredit);

  // Assets greater than liabilities: the owner has capital in the business.
  // The other way round and capital is negative, which is a debit. Both balance.
  if (isGreaterThan(capital, 0)) {
    credits.push({
      accountCode: SYSTEM_ACCOUNT.OWNERS_CAPITAL,
      credit: round(capital, MONEY_DP),
      description: `Opening capital - ${label}`,
    });
  } else if (isGreaterThan(0, capital)) {
    debits.push({
      accountCode: SYSTEM_ACCOUNT.OWNERS_CAPITAL,
      debit: round(capital.negated(), MONEY_DP),
      description: `Opening capital - ${label}`,
    });
  }

  return [...debits, ...credits];
}

// --- writes ----------------------------------------------------------------

/**
 * Establishes a company's opening balances. Runs once, in one transaction.
 *
 * Order inside the transaction matches every other posting in this codebase:
 * the sub-ledgers and the stock first, the journal LAST. That keeps the global
 * lock order identical to every document flow, so an initialization cannot
 * deadlock against a sale posting at the same moment.
 */
export async function initialize(currentUser, input) {
  const { companyId } = currentUser;

  // A refusal before the transaction gives a clean error rather than a
  // constraint violation. The database is still the real guarantee - see below.
  const existing = await openingBalanceRepository.findOpeningEntry(companyId);
  if (existing) {
    throw ApiError.business(
      409,
      'OPENING_BALANCES_ALREADY_INITIALIZED',
      `Opening balances were already set on ${toDateString(existing.entryDate)} (${existing.journalNumber}).` +
        ' They are an initialization, not a document, and cannot be set twice.',
    );
  }

  const references = await loadAndValidateReferences(companyId, input);

  const hasAnything =
    isGreaterThan(input.cash ?? 0, 0) ||
    (input.bankAccounts ?? []).length > 0 ||
    (input.customers ?? []).length > 0 ||
    (input.suppliers ?? []).length > 0 ||
    (input.inventory ?? []).length > 0 ||
    (input.otherBalances ?? []).length > 0;

  if (!hasAnything) {
    throw ApiError.business(
      422,
      'EMPTY_OPENING_BALANCES',
      'An initialization with nothing in it would record nothing. Give at least one opening balance.',
    );
  }

  const result = await withRetryableTransaction(async (tx) => {
    const asOfDate = input.asOfDate;

    // --- customers: a receivable with no invoice, and a ledger entry --------
    let receivableTotal = toDecimal(0);
    const customerRows = [];

    for (const row of input.customers ?? []) {
      assertPositive(row.amount, 'An opening customer balance');
      const customer = references.customerById.get(row.customerId);
      const amount = round(row.amount, MONEY_DP);

      // A real receivable, so the money can be collected, aged and allocated
      // against by an ordinary receipt. No invoice behind it, because there was
      // no sale - that is exactly what makes it an opening balance.
      const receivable = await customerReceivableRepository.create(tx, {
        companyId,
        customerId: customer.id,
        salesInvoiceId: null,
        originalAmount: amount,
        creditAmount: 0,
        paidAmount: 0,
        outstandingAmount: amount,
        dueDate: row.dueDate ?? null,
        status: 'OPEN',
      });

      await customerLedgerRepository.create(tx, {
        companyId,
        customerId: customer.id,
        entryType: 'OPENING_BALANCE',
        entryDate: asOfDate,
        // A customer debit is money they owe us.
        debit: amount,
        credit: 0,
        referenceType: CUSTOMER_REFERENCE_TYPE.OPENING_BALANCE,
        // The COMPANY id, so the ledger's unique key makes this entry
        // unrepeatable per customer just as the journal's does per company.
        referenceId: customer.id,
        receivableId: receivable.id,
        description: row.reference
          ? `Opening balance (${row.reference})`
          : 'Opening balance',
        createdById: currentUser.id,
      });

      receivableTotal = add(receivableTotal, amount);
      customerRows.push({ customer, amount, receivableId: receivable.id });
    }

    // --- suppliers: the mirror image ---------------------------------------
    let payableTotal = toDecimal(0);
    const supplierRows = [];

    for (const row of input.suppliers ?? []) {
      assertPositive(row.amount, 'An opening supplier balance');
      const supplier = references.supplierById.get(row.supplierId);
      const amount = round(row.amount, MONEY_DP);

      const payable = await supplierPayableRepository.create(tx, {
        companyId,
        supplierId: supplier.id,
        purchaseId: null,
        originalAmount: amount,
        creditAmount: 0,
        paidAmount: 0,
        outstandingAmount: amount,
        dueDate: row.dueDate ?? null,
        status: 'OPEN',
      });

      await supplierLedgerRepository.create(tx, {
        companyId,
        supplierId: supplier.id,
        entryType: 'OPENING_BALANCE',
        entryDate: asOfDate,
        // A supplier credit is money we owe them.
        debit: 0,
        credit: amount,
        referenceType: SUPPLIER_REFERENCE_TYPE.OPENING_BALANCE,
        referenceId: supplier.id,
        payableId: payable.id,
        description: row.reference ? `Opening balance (${row.reference})` : 'Opening balance',
        createdById: currentUser.id,
      });

      payableTotal = add(payableTotal, amount);
      supplierRows.push({ supplier, amount, payableId: payable.id });
    }

    // --- inventory: the existing module, at its own valuation ---------------
    //
    // applyMovementWithinTransaction is the one place the moving weighted
    // average lives. Calling it means opening stock is valued by exactly the
    // same arithmetic every purchase uses, and the Inventory GL line below is
    // the sum of what the movements actually recorded - so the ledger and the
    // stock module cannot disagree by construction.
    let inventoryValue = toDecimal(0);
    const inventoryRows = [];

    for (const row of input.inventory ?? []) {
      assertPositive(row.quantity, 'An opening stock quantity');
      if (isGreaterThan(0, toDecimal(row.unitCost))) {
        throw ApiError.business(
          422,
          'INVALID_OPENING_AMOUNT',
          'An opening stock unit cost cannot be negative',
        );
      }

      const product = references.productById.get(row.productId);

      const movement = await inventoryService.applyMovementWithinTransaction(tx, {
        currentUser,
        productId: row.productId,
        warehouseId: row.warehouseId,
        type: 'OPENING_STOCK',
        direction: 'IN',
        quantity: round(row.quantity, QUANTITY_DP),
        unitCost: round(row.unitCost, MONEY_DP),
        referenceType: INVENTORY_REFERENCE_TYPE.OPENING_STOCK,
        referenceId: companyId,
        notes: 'Opening balances',
        // Refuses if stock already exists: an initialization must not silently
        // overwrite real quantities.
        requireNoExistingBalance: true,
      });

      inventoryValue = add(inventoryValue, movement.totalCost);
      inventoryRows.push({ product, movement });
    }

    // --- bank accounts ------------------------------------------------------
    const bankLines = (input.bankAccounts ?? []).map((row) => {
      assertPositive(row.amount, 'An opening bank balance');
      const account = row.accountId ? references.accountById.get(row.accountId) : null;

      return {
        accountId: account?.id ?? null,
        // With no account named, the system Bank account is used - which is what
        // a business with a single bank account wants.
        accountCode: account ? undefined : SYSTEM_ACCOUNT.BANK,
        amount: round(row.amount, MONEY_DP),
        account,
      };
    });

    // Cash is optional, but a cash line of zero or less is a mistake, not a
    // balance of nothing - omit the field instead.
    if (input.cash !== undefined && input.cash !== null) {
      assertPositive(input.cash, 'Opening cash');
    }

    // --- the journal, LAST, through the existing posting service ------------
    const entry = await createPostedEntryWithinTransaction(tx, currentUser, {
      entryDate: asOfDate,
      description: `Opening balances as at ${toDateString(asOfDate)}`,
      sourceType: SOURCE_TYPE.OPENING_BALANCE,
      // The company's own id. The existing unique key on
      // (companyId, sourceType, sourceId) makes a second initialization
      // impossible at the database, including under two simultaneous requests.
      sourceId: companyId,
      lines: buildOpeningLines({
        cash: input.cash ?? 0,
        bankByAccountId: bankLines,
        inventoryValue,
        receivableTotal,
        payableTotal,
        // The account type comes from the account itself, loaded and checked
        // above - never from the request.
        otherLines: (input.otherBalances ?? []).map((row) => {
          const account = references.otherAccountById.get(row.accountId);
          return {
            accountId: account.id,
            accountCode: account.code,
            type: account.type,
            amount: row.amount,
            description: row.description ?? account.name,
          };
        }),
        asOfDate,
      }),
    });

    return { entry, customerRows, supplierRows, inventoryRows, bankLines, asOfDate };
  });

  return toPublicInitialization(result);
}

function toPublicInitialization({ entry, customerRows, supplierRows, inventoryRows, bankLines, asOfDate }) {
  return {
    initialized: true,
    asOfDate: toDateString(asOfDate),
    journalNumber: entry.journalNumber,
    journalEntryId: entry.id,
    totalDebit: money(entry.totalDebit),
    totalCredit: money(entry.totalCredit),
    isBalanced: toDecimal(entry.totalDebit).equals(toDecimal(entry.totalCredit)),
    customers: customerRows.map((row) => ({
      customerId: row.customer.id,
      name: row.customer.name,
      amount: money(row.amount),
    })),
    suppliers: supplierRows.map((row) => ({
      supplierId: row.supplier.id,
      name: row.supplier.name,
      amount: money(row.amount),
    })),
    inventory: inventoryRows.map((row) => ({
      productId: row.product.id,
      name: row.product.name,
      quantity: toMoneyString(row.movement.quantity, 3),
      unitCost: money(row.movement.unitCost),
      totalValue: money(row.movement.totalCost),
    })),
    bankAccounts: bankLines.map((row) => ({
      accountId: row.account?.id ?? null,
      code: row.account?.code ?? SYSTEM_ACCOUNT.BANK,
      name: row.account?.name ?? 'Bank',
      amount: money(row.amount),
    })),
    note: 'Opening balances are an initialization, not a transaction. They create no sale, no purchase and no expense, and never appear as revenue or cost in a profit and loss.',
  };
}

// --- reads -----------------------------------------------------------------

/** Whether this company has been initialized, and with what. */
export async function getStatus(currentUser) {
  const { companyId } = currentUser;
  const entry = await openingBalanceRepository.findOpeningEntry(companyId);

  if (!entry) {
    return {
      initialized: false,
      asOfDate: null,
      note: 'This company has no opening balances. It started with empty books, which is correct for a business that began here.',
    };
  }

  return {
    initialized: true,
    asOfDate: toDateString(entry.entryDate),
    journalNumber: entry.journalNumber,
    journalEntryId: entry.id,
    totalDebit: money(entry.totalDebit),
    totalCredit: money(entry.totalCredit),
    isBalanced: toDecimal(entry.totalDebit).equals(toDecimal(entry.totalCredit)),
    initializedBy: entry.createdBy ? { id: entry.createdBy.id, name: entry.createdBy.name } : null,
    initializedAt: entry.createdAt,
  };
}

/**
 * The full breakdown, read back from where each figure actually lives.
 *
 * Nothing here is stored twice: the journal lines come from the GL, the customer
 * and supplier rows from their sub-ledgers, the stock from the inventory module.
 * If any of them were later corrected, this read would show the correction.
 */
export async function getDetails(currentUser) {
  const { companyId } = currentUser;
  const entry = await openingBalanceRepository.findOpeningEntry(companyId);

  if (!entry) {
    throw ApiError.business(
      404,
      'OPENING_BALANCES_NOT_INITIALIZED',
      'This company has no opening balances',
    );
  }

  const [lines, customers, suppliers, stock] = await Promise.all([
    openingBalanceRepository.findOpeningJournalLines(companyId, entry.id),
    openingBalanceRepository.findOpeningCustomerEntries(companyId),
    openingBalanceRepository.findOpeningSupplierEntries(companyId),
    openingBalanceRepository.findOpeningStockMovements(companyId),
  ]);

  return {
    initialized: true,
    asOfDate: toDateString(entry.entryDate),
    journalNumber: entry.journalNumber,
    journalEntryId: entry.id,
    totals: {
      totalDebit: money(entry.totalDebit),
      totalCredit: money(entry.totalCredit),
      isBalanced: toDecimal(entry.totalDebit).equals(toDecimal(entry.totalCredit)),
    },
    journal: lines.map((line) => ({
      account: { id: line.account.id, code: line.account.code, name: line.account.name, type: line.account.type },
      description: line.description,
      debit: money(line.debit),
      credit: money(line.credit),
    })),
    customers: customers.map((row) => ({
      customerId: row.customer.id,
      name: row.customer.name,
      amount: money(row.debit),
      description: row.description,
    })),
    suppliers: suppliers.map((row) => ({
      supplierId: row.supplier.id,
      name: row.supplier.name,
      amount: money(row.credit),
      description: row.description,
    })),
    inventory: stock.map((row) => ({
      productId: row.product.id,
      name: row.product.name,
      warehouse: { id: row.warehouse.id, name: row.warehouse.name },
      quantity: toMoneyString(row.quantity, 3),
      unitCost: money(row.unitCost),
      totalValue: money(row.totalCost),
    })),
    initializedBy: entry.createdBy ? { id: entry.createdBy.id, name: entry.createdBy.name } : null,
    initializedAt: entry.createdAt,
    note: 'Every figure here is read from where it lives - the general ledger, the two sub-ledgers and the inventory module. Nothing is stored a second time.',
  };
}

export { money, toDateString };
