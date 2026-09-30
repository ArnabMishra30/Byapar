import { Router } from 'express';
import * as partyController from './party.controller.js';
import {
  listPartiesQuerySchema,
  createPartySchema,
  updatePartySchema,
  possibleMatchesQuerySchema,
  addRelationshipSchema,
  linkPartySchema,
  partyLedgerQuerySchema,
} from './party.validation.js';
import { validate } from '../../middlewares/validate.js';
import { requireAuth } from '../../middlewares/require-auth.js';
import { requireRole } from '../../middlewares/require-role.js';
import { idParamSchema, statusSchema } from '../../utils/validation.js';

export const partyRoutes = Router();

// The same rule as /customers and /suppliers: the shop's ADMIN and STAFF may
// read, only the ADMIN changes master data. requireRole on reads as well keeps
// the platform's own users (who belong to no shop) out entirely.
partyRoutes.use(requireAuth);

const shopUser = requireRole('ADMIN', 'STAFF');
const shopAdmin = requireRole('ADMIN');

partyRoutes.get('/', shopUser, validate({ query: listPartiesQuerySchema }), partyController.list);
partyRoutes.get('/summary', shopUser, partyController.summary);
partyRoutes.get(
  '/possible-matches',
  shopUser,
  validate({ query: possibleMatchesQuerySchema }),
  partyController.possibleMatches,
);
partyRoutes.get('/:id', shopUser, validate({ params: idParamSchema }), partyController.get);

// Ledgers and statements are the existing customer/supplier ones, reached
// through the party. Nothing new is calculated.
partyRoutes.get(
  '/:id/customer-ledger',
  shopUser,
  validate({ params: idParamSchema, query: partyLedgerQuerySchema }),
  partyController.customerLedger,
);
partyRoutes.get(
  '/:id/supplier-ledger',
  shopUser,
  validate({ params: idParamSchema, query: partyLedgerQuerySchema }),
  partyController.supplierLedger,
);
partyRoutes.get(
  '/:id/statement',
  shopUser,
  validate({ params: idParamSchema, query: partyLedgerQuerySchema }),
  partyController.statement,
);

partyRoutes.post('/', shopAdmin, validate({ body: createPartySchema }), partyController.create);
partyRoutes.patch(
  '/:id',
  shopAdmin,
  validate({ params: idParamSchema, body: updatePartySchema }),
  partyController.update,
);
partyRoutes.patch(
  '/:id/status',
  shopAdmin,
  validate({ params: idParamSchema, body: statusSchema }),
  partyController.updateStatus,
);
partyRoutes.post(
  '/:id/relationships',
  shopAdmin,
  validate({ params: idParamSchema, body: addRelationshipSchema }),
  partyController.addRelationship,
);
partyRoutes.post(
  '/:id/link',
  shopAdmin,
  validate({ params: idParamSchema, body: linkPartySchema }),
  partyController.link,
);
