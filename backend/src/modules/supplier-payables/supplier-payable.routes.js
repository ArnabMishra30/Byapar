import { Router } from 'express';
import * as supplierPayableController from './supplier-payable.controller.js';
import {
  listPayablesQuerySchema,
  supplierIdParamSchema,
  ledgerQuerySchema,
} from './supplier-payable.validation.js';
import { validate } from '../../middlewares/validate.js';
import { requireAuth } from '../../middlewares/require-auth.js';
import { idParamSchema } from '../../utils/validation.js';

// Payables and the ledger are read-only over HTTP: they are written only as a
// side effect of posting a purchase, a purchase return or a payment.
// Reads are open to ADMIN and STAFF.

export const supplierPayableRoutes = Router();

supplierPayableRoutes.use(requireAuth);

supplierPayableRoutes.get(
  '/',
  validate({ query: listPayablesQuerySchema }),
  supplierPayableController.listPayables,
);

supplierPayableRoutes.get(
  '/:id',
  validate({ params: idParamSchema }),
  supplierPayableController.getPayable,
);

/**
 * Mounted separately at /api/v1/suppliers so the ledger reads as a property of
 * the supplier. Two-segment paths, so they never collide with the suppliers
 * module's own /:id route.
 */
export const supplierLedgerRoutes = Router();

supplierLedgerRoutes.use(requireAuth);

supplierLedgerRoutes.get(
  '/:supplierId/ledger',
  validate({ params: supplierIdParamSchema, query: ledgerQuerySchema }),
  supplierPayableController.supplierLedger,
);

supplierLedgerRoutes.get(
  '/:supplierId/outstanding',
  validate({ params: supplierIdParamSchema }),
  supplierPayableController.supplierOutstanding,
);

supplierLedgerRoutes.get(
  '/:supplierId/payables',
  validate({ params: supplierIdParamSchema }),
  supplierPayableController.supplierOutstandingPayables,
);
