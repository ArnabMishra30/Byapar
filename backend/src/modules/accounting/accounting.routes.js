import { Router } from 'express';
import * as accountingController from './accounting.controller.js';
import {
  createAccountSchema,
  updateAccountSchema,
  listAccountsQuerySchema,
  accountLedgerQuerySchema,
  listJournalEntriesQuerySchema,
  reverseJournalEntrySchema,
  sourceParamsSchema,
  generalLedgerQuerySchema,
  generalLedgerSummaryQuerySchema,
  asOfDateQuerySchema,
  dateRangeQuerySchema,
} from './accounting.validation.js';
import { validate } from '../../middlewares/validate.js';
import { requireAuth } from '../../middlewares/require-auth.js';
import { requireRole } from '../../middlewares/require-role.js';
import { idParamSchema } from '../../utils/validation.js';

// RBAC, following the convention the rest of the project already uses:
//
//   READ  (accounts, journals, ledger, statements)   ADMIN and STAFF
//   WRITE (create/edit/delete an account, reverse a journal)   ADMIN only
//
// There is deliberately NO endpoint that creates or edits a journal entry.
// Journals exist only because a business document was posted, which is what
// makes "normal users cannot manipulate posted accounting records" true for
// every role, including ADMIN.

// --- /api/v1/accounts ------------------------------------------------------

export const accountRoutes = Router();
accountRoutes.use(requireAuth);

accountRoutes.get(
  '/',
  validate({ query: listAccountsQuerySchema }),
  accountingController.listAccounts,
);

accountRoutes.get('/:id', validate({ params: idParamSchema }), accountingController.getAccount);

accountRoutes.get(
  '/:id/ledger',
  validate({ params: idParamSchema, query: accountLedgerQuerySchema }),
  accountingController.getAccountLedger,
);

accountRoutes.post(
  '/',
  requireRole('ADMIN'),
  validate({ body: createAccountSchema }),
  accountingController.createAccount,
);

accountRoutes.patch(
  '/:id',
  requireRole('ADMIN'),
  validate({ params: idParamSchema, body: updateAccountSchema }),
  accountingController.updateAccount,
);

accountRoutes.delete(
  '/:id',
  requireRole('ADMIN'),
  validate({ params: idParamSchema }),
  accountingController.deleteAccount,
);

// --- /api/v1/journal-entries ----------------------------------------------

export const journalEntryRoutes = Router();
journalEntryRoutes.use(requireAuth);

// Declared before /:id so "source" is never read as an entry id.
journalEntryRoutes.get(
  '/source/:sourceType/:sourceId',
  validate({ params: sourceParamsSchema }),
  accountingController.getJournalEntryBySource,
);

journalEntryRoutes.get(
  '/',
  validate({ query: listJournalEntriesQuerySchema }),
  accountingController.listJournalEntries,
);

journalEntryRoutes.get(
  '/:id',
  validate({ params: idParamSchema }),
  accountingController.getJournalEntry,
);

// A correction tool, not part of any document flow. Idempotent: a second call
// is refused because the reversal already exists.
journalEntryRoutes.post(
  '/:id/reverse',
  requireRole('ADMIN'),
  validate({ params: idParamSchema, body: reverseJournalEntrySchema }),
  accountingController.reverseJournalEntry,
);

// --- /api/v1/general-ledger ------------------------------------------------

export const generalLedgerRoutes = Router();
generalLedgerRoutes.use(requireAuth);

// Declared before the list route so it is matched exactly.
generalLedgerRoutes.get(
  '/summary',
  validate({ query: generalLedgerSummaryQuerySchema }),
  accountingController.getGeneralLedgerSummary,
);

generalLedgerRoutes.get(
  '/',
  validate({ query: generalLedgerQuerySchema }),
  accountingController.listGeneralLedger,
);

// --- /api/v1/accounting (financial statements) -----------------------------

export const accountingRoutes = Router();
accountingRoutes.use(requireAuth);

accountingRoutes.get(
  '/trial-balance',
  validate({ query: asOfDateQuerySchema }),
  accountingController.getTrialBalance,
);

accountingRoutes.get(
  '/profit-loss',
  validate({ query: dateRangeQuerySchema }),
  accountingController.getProfitAndLoss,
);

accountingRoutes.get(
  '/balance-sheet',
  validate({ query: asOfDateQuerySchema }),
  accountingController.getBalanceSheet,
);
