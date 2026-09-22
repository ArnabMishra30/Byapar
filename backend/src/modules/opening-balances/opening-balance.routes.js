import { Router } from 'express';
import * as openingBalanceController from './opening-balance.controller.js';
import { initializeOpeningBalancesSchema } from './opening-balance.validation.js';
import { validate } from '../../middlewares/validate.js';
import { requireAuth } from '../../middlewares/require-auth.js';
import { requireRole } from '../../middlewares/require-role.js';

// RBAC, matching every other accounting-impacting operation in this project:
//
//   Reads                 ADMIN and STAFF
//   Initialization        ADMIN only
//
// Establishing opening balances writes a journal entry, two sub-ledgers and the
// stock ledger in one go. That is the largest single accounting act in the
// system, so it sits at the same level as posting a document.
//
// There is no PATCH and no DELETE. Opening balances are an initialization, not a
// document: once the books are established they are history, and history in this
// system is corrected by a new entry rather than by editing an old one.

export const openingBalanceRoutes = Router();

openingBalanceRoutes.use(requireAuth);

openingBalanceRoutes.get('/', openingBalanceController.getStatus);

openingBalanceRoutes.get('/details', openingBalanceController.getDetails);

openingBalanceRoutes.post(
  '/',
  requireRole('ADMIN'),
  validate({ body: initializeOpeningBalancesSchema }),
  openingBalanceController.initialize,
);
