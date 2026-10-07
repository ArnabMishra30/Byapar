import { Router } from 'express';
import { z } from 'zod';
import * as moneyAccountService from './money-account.service.js';
import { validate } from '../../middlewares/validate.js';
import { requireAuth } from '../../middlewares/require-auth.js';
import { requireRole } from '../../middlewares/require-role.js';
import { requireShopPermission } from '../users/shop-permissions.js';
import { idParamSchema, moneySchema } from '../../utils/validation.js';
import { sendSuccess } from '../../utils/response.js';

const businessDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
  .transform((value) => new Date(`${value}T00:00:00.000Z`));

// Reference details for a money account. All optional; checked only when given.
const optionalText = (max) => z.string().trim().max(max).nullable().optional();
const referenceFields = {
  bankName: optionalText(80),
  accountNumber: z
    .string()
    .trim()
    .regex(/^\d{6,18}$/, 'An account number is 6 to 18 digits')
    .nullable()
    .optional()
    .or(z.literal('')),
  ifsc: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'An IFSC looks like SBIN0001234')
    .nullable()
    .optional()
    .or(z.literal('')),
  upiId: z
    .string()
    .trim()
    .regex(/^[\w.-]{2,}@[a-zA-Z][a-zA-Z0-9.]{1,}$/, 'A UPI ID looks like shopname@ybl')
    .nullable()
    .optional()
    .or(z.literal('')),
  holderName: optionalText(120),
};

const positiveMoney = (label) =>
  moneySchema(label, { decimals: 2 }).refine((value) => Number(value) > 0, { message: `${label} must be more than zero` });

export const moneyAccountRoutes = Router();

// Anyone at the shop may see the accounts (to pick one when taking money).
// Setting them up is the owner's; moving money between them needs MONEY_PAY.
moneyAccountRoutes.use(requireAuth);

moneyAccountRoutes.get(
  '/',
  requireRole('ADMIN', 'STAFF'),
  validate({ query: z.object({ active: z.enum(['true', 'false']).optional() }) }),
  async (req, res) =>
    sendSuccess(res, {
      accounts: await moneyAccountService.list(req.user, { activeOnly: req.validated.query.active === 'true' }),
    }),
);

moneyAccountRoutes.post(
  '/',
  requireRole('ADMIN'),
  validate({
    body: z
      .object({
        name: z.string().trim().min(2, 'Give the account a name').max(80),
        kind: z.enum(['CASH', 'BANK']),
        openingBalance: moneySchema('Opening balance', { decimals: 2 }).optional(),
        openingDate: businessDate.optional(),
        ...referenceFields,
      })
      .strict(),
  }),
  async (req, res) =>
    sendSuccess(res, { account: await moneyAccountService.create(req.user, req.validated.body) }, 201, 'Account added'),
);

moneyAccountRoutes.patch(
  '/:id',
  requireRole('ADMIN'),
  validate({
    params: idParamSchema,
    body: z
      .object({ name: z.string().trim().min(2).max(80).optional(), isActive: z.boolean().optional(), ...referenceFields })
      .strict()
      .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to change' }),
  }),
  async (req, res) =>
    sendSuccess(res, { account: await moneyAccountService.update(req.user, req.validated.params.id, req.validated.body) }),
);

moneyAccountRoutes.get('/transfers', requireShopPermission('MONEY_PAY', 'REPORTS_VIEW'), async (req, res) =>
  sendSuccess(res, { transfers: await moneyAccountService.listTransfers(req.user) }),
);

moneyAccountRoutes.post(
  '/transfers',
  requireShopPermission('MONEY_PAY'),
  validate({
    body: z
      .object({
        fromAccountId: z.string().uuid(),
        toAccountId: z.string().uuid(),
        amount: positiveMoney('Amount'),
        date: businessDate,
        notes: z.string().trim().max(200).nullable().optional(),
      })
      .strict(),
  }),
  async (req, res) =>
    sendSuccess(res, { transfer: await moneyAccountService.transfer(req.user, req.validated.body) }, 201, 'Transfer recorded'),
);

moneyAccountRoutes.post(
  '/transfers/:id/reverse',
  requireRole('ADMIN'),
  validate({ params: idParamSchema }),
  async (req, res) => sendSuccess(res, await moneyAccountService.reverseTransfer(req.user, req.validated.params.id)),
);
