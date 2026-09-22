import { Router } from 'express';
import * as creditController from './credit.controller.js';
import {
  statementQuerySchema,
  collectionSummaryQuerySchema,
  creditPositionQuerySchema,
  partyIdParamSchema,
} from './credit.validation.js';
import { validate } from '../../middlewares/validate.js';
import { requireAuth } from '../../middlewares/require-auth.js';

// RBAC: everything in this module is a READ, and every read is open to ADMIN and
// STAFF - the same rule the existing credit book, ledgers and reports follow. A
// staff member who takes payments has to be able to see who owes what.
//
// Nothing here writes. The one place Phase 14 changes behaviour is the credit
// check inside sales posting, which is already ADMIN-only, and the override on
// that call inherits the same restriction.

// --- /api/v1/credit (extends the existing credit book) ---------------------

export const creditCollectionRoutes = Router();

creditCollectionRoutes.use(requireAuth);

creditCollectionRoutes.get(
  '/collections',
  validate({ query: collectionSummaryQuerySchema }),
  creditController.collectionSummary,
);

creditCollectionRoutes.get(
  '/payables-summary',
  validate({ query: collectionSummaryQuerySchema }),
  creditController.payablesSummary,
);

creditCollectionRoutes.get(
  '/exposure',
  validate({ query: creditPositionQuerySchema }),
  creditController.creditExposure,
);

/**
 * Mounted at /api/v1/customers so a statement reads as a property of the
 * customer, matching the existing /:id/ledger and /:id/outstanding routes.
 * Two-segment paths, so they never collide with the customers module's /:id.
 */
export const customerCreditRoutes = Router();

customerCreditRoutes.use(requireAuth);

customerCreditRoutes.get(
  '/:id/statement',
  validate({ params: partyIdParamSchema, query: statementQuerySchema }),
  creditController.customerStatement,
);

customerCreditRoutes.get(
  '/:id/credit',
  validate({ params: partyIdParamSchema, query: creditPositionQuerySchema }),
  creditController.customerCredit,
);

/** The supplier-side mirror, mounted at /api/v1/suppliers. */
export const supplierCreditRoutes = Router();

supplierCreditRoutes.use(requireAuth);

supplierCreditRoutes.get(
  '/:id/statement',
  validate({ params: partyIdParamSchema, query: statementQuerySchema }),
  creditController.supplierStatement,
);
