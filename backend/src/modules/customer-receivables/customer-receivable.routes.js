import { Router } from 'express';
import * as customerReceivableController from './customer-receivable.controller.js';
import {
  listReceivablesQuerySchema,
  customerIdParamSchema,
  ledgerQuerySchema,
  customerPaymentsQuerySchema,
} from './customer-receivable.validation.js';
import { validate } from '../../middlewares/validate.js';
import { requireAuth } from '../../middlewares/require-auth.js';
import { idParamSchema } from '../../utils/validation.js';

// Receivables and the ledger are read-only over HTTP: they are written only as a
// side effect of posting a sales invoice or a customer payment.
// Reads are open to ADMIN and STAFF.

export const customerReceivableRoutes = Router();

customerReceivableRoutes.use(requireAuth);

customerReceivableRoutes.get(
  '/',
  validate({ query: listReceivablesQuerySchema }),
  customerReceivableController.listReceivables,
);

customerReceivableRoutes.get(
  '/:id',
  validate({ params: idParamSchema }),
  customerReceivableController.getReceivable,
);

/**
 * Mounted separately at /api/v1/customers so the ledger reads as a property of
 * the customer. Two-segment paths, so they never collide with the customers
 * module's own /:id route.
 */
export const customerLedgerRoutes = Router();

customerLedgerRoutes.use(requireAuth);

customerLedgerRoutes.get(
  '/:id/ledger',
  validate({ params: customerIdParamSchema, query: ledgerQuerySchema }),
  customerReceivableController.customerLedger,
);

customerLedgerRoutes.get(
  '/:id/outstanding',
  validate({ params: customerIdParamSchema }),
  customerReceivableController.customerOutstanding,
);

customerLedgerRoutes.get(
  '/:id/receivables',
  validate({ params: customerIdParamSchema }),
  customerReceivableController.customerReceivables,
);

customerLedgerRoutes.get(
  '/:id/payments',
  validate({ params: customerIdParamSchema, query: customerPaymentsQuerySchema }),
  customerReceivableController.customerPayments,
);
