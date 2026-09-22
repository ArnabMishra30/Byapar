import { z } from 'zod';
import { moneySchema, quantitySchema } from '../../utils/validation.js';

// Zod schemas for opening balances.
//
// NO GST FIELD APPEARS ANYWHERE IN THIS FILE, and none should. There is no
// GSTIN, no HSN, no place of supply, no tax rate and no state code: a shop with
// no registration establishes its books with a date, some amounts and some
// names, exactly as a registered company does.

/**
 * A business date, "YYYY-MM-DD", stored at UTC midnight so it cannot shift.
 *
 * The round trip matters: `new Date("2026-02-30")` does not fail, it rolls
 * forward into March. Formatting the parsed date back and comparing is what
 * catches an impossible calendar day rather than silently accepting a different
 * one - and an opening balance dated a day it was not is a bad start.
 */
function businessDate(label, { required = true } = {}) {
  const schema = z
    .string(required ? { required_error: `${label} is required` } : undefined)
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be in YYYY-MM-DD format`)
    .refine(
      (value) => {
        // A month of 13 gives an Invalid Date, whose toISOString throws, so the
        // validity check has to come first.
        const parsed = new Date(`${value}T00:00:00.000Z`);
        if (Number.isNaN(parsed.getTime())) return false;
        return parsed.toISOString().slice(0, 10) === value;
      },
      { message: `${label} is not a real calendar date` },
    )
    .transform((value) => new Date(`${value}T00:00:00.000Z`));

  return required ? schema : schema.nullable().optional();
}

const referenceSchema = z
  .string()
  .trim()
  .max(100, 'A reference is too long')
  .nullable()
  .optional();

/** What one customer already owed. No invoice, because there was no sale. */
const customerOpeningSchema = z.object({
  customerId: z.string({ required_error: 'customerId is required' }).uuid('Invalid customerId'),
  amount: moneySchema('An opening customer balance', { decimals: 2 }),
  /** Optional, and what makes an opening due age like any other. */
  dueDate: businessDate('dueDate', { required: false }),
  reference: referenceSchema,
});

const supplierOpeningSchema = z.object({
  supplierId: z.string({ required_error: 'supplierId is required' }).uuid('Invalid supplierId'),
  amount: moneySchema('An opening supplier balance', { decimals: 2 }),
  dueDate: businessDate('dueDate', { required: false }),
  reference: referenceSchema,
});

const inventoryOpeningSchema = z.object({
  productId: z.string({ required_error: 'productId is required' }).uuid('Invalid productId'),
  warehouseId: z.string({ required_error: 'warehouseId is required' }).uuid('Invalid warehouseId'),
  quantity: quantitySchema('An opening stock quantity'),
  /** Zero is legitimate - a free sample has a real quantity and no cost. */
  unitCost: moneySchema('An opening stock unit cost', { decimals: 4 }),
});

/**
 * A bank account. `accountId` names one when the business has several; omitted,
 * the system Bank account is used, which is what a business with one wants.
 */
const bankOpeningSchema = z.object({
  accountId: z.string().uuid('Invalid accountId').nullable().optional(),
  amount: moneySchema('An opening bank balance', { decimals: 2 }),
});

/**
 * Anything else the business already owns or owes.
 *
 * A vehicle, a security deposit, a bank loan, capital the owner has already put
 * in. The dedicated fields above cover what almost every shop has; this covers
 * the rest without inventing a field per asset class.
 *
 * The SIDE IS NOT SUPPLIED. It is derived from the account's own type, because
 * an asset is a debit and a liability is a credit whatever a caller believes.
 * That is also what stops "opening balance" being used to post revenue.
 */
const otherOpeningSchema = z.object({
  accountId: z.string({ required_error: 'accountId is required' }).uuid('Invalid accountId'),
  amount: moneySchema('An opening balance', { decimals: 2 }),
  description: z.string().trim().max(200, 'Description is too long').nullable().optional(),
});

export const initializeOpeningBalancesSchema = z
  .object({
    /** The date the books start. Every opening figure is "as at" this date. */
    asOfDate: businessDate('asOfDate'),

    cash: moneySchema('Opening cash', { decimals: 2 }).nullable().optional(),
    bankAccounts: z.array(bankOpeningSchema).max(50, 'Too many bank accounts').optional(),
    customers: z.array(customerOpeningSchema).max(1000, 'Too many customers').optional(),
    suppliers: z.array(supplierOpeningSchema).max(1000, 'Too many suppliers').optional(),
    inventory: z.array(inventoryOpeningSchema).max(5000, 'Too many stock lines').optional(),

    /** Other assets, liabilities and equity the business already has. */
    otherBalances: z.array(otherOpeningSchema).max(200, 'Too many other balances').optional(),
  })
  .strict();
