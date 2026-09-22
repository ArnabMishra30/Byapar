import { Router } from 'express';
import * as periodController from './period.controller.js';
import {
  createPeriodSchema,
  reopenPeriodSchema,
  listPeriodsQuerySchema,
  checkDateQuerySchema,
} from './period.validation.js';
import { validate } from '../../middlewares/validate.js';
import { requireAuth } from '../../middlewares/require-auth.js';
import { requireRole } from '../../middlewares/require-role.js';
import { idParamSchema } from '../../utils/validation.js';

// RBAC, matching every other accounting-impacting operation in this project:
//
//   Reads                            ADMIN and STAFF
//   Create, close, reopen a period   ADMIN only
//
// Closing a period stops other people posting. That is an administrative act,
// and a staff member must not be able to freeze the books - nor to thaw them.
//
// There is no DELETE. A period that was closed is part of the audit trail; if it
// was closed by mistake it is reopened, with a reason and a name against it.

export const periodRoutes = Router();

periodRoutes.use(requireAuth);

// Declared before /:id so "check" is never read as a period id.
periodRoutes.get(
  '/check',
  validate({ query: checkDateQuerySchema }),
  periodController.checkDate,
);

periodRoutes.get('/', validate({ query: listPeriodsQuerySchema }), periodController.list);

periodRoutes.get('/:id', validate({ params: idParamSchema }), periodController.get);

// Read-only preflight: what a close would check, and whether it would pass.
// Not gated to ADMIN because it changes nothing and answering "do our books
// reconcile?" is not a privileged question inside a company.
periodRoutes.get(
  '/:id/verify',
  validate({ params: idParamSchema }),
  periodController.verify,
);

periodRoutes.post(
  '/',
  requireRole('ADMIN'),
  validate({ body: createPeriodSchema }),
  periodController.create,
);

periodRoutes.post(
  '/:id/close',
  requireRole('ADMIN'),
  validate({ params: idParamSchema }),
  periodController.close,
);

// Closing the wrong month is a mistake a person will make. Reopening is
// deliberate and attributed rather than impossible.
periodRoutes.post(
  '/:id/reopen',
  requireRole('ADMIN'),
  validate({ params: idParamSchema, body: reopenPeriodSchema }),
  periodController.reopen,
);
