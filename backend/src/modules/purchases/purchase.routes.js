import { Router } from 'express';
import * as purchaseController from './purchase.controller.js';
import {
  createPurchaseSchema,
  updatePurchaseSchema,
  listPurchasesQuerySchema,
} from './purchase.validation.js';
import { validate } from '../../middlewares/validate.js';
import { requireAuth } from '../../middlewares/require-auth.js';
import { requireRole } from '../../middlewares/require-role.js';
import { idParamSchema } from '../../utils/validation.js';

export const purchaseRoutes = Router();

// Read: ADMIN and STAFF. Every state change: ADMIN only.
// There is no DELETE: a draft is cancelled, and a posted purchase is permanent.
purchaseRoutes.use(requireAuth);

purchaseRoutes.get('/', validate({ query: listPurchasesQuerySchema }), purchaseController.list);
purchaseRoutes.get('/:id', validate({ params: idParamSchema }), purchaseController.get);

purchaseRoutes.post(
  '/',
  requireRole('ADMIN'),
  validate({ body: createPurchaseSchema }),
  purchaseController.create,
);

purchaseRoutes.patch(
  '/:id',
  requireRole('ADMIN'),
  validate({ params: idParamSchema, body: updatePurchaseSchema }),
  purchaseController.update,
);

purchaseRoutes.post(
  '/:id/post',
  requireRole('ADMIN'),
  validate({ params: idParamSchema }),
  purchaseController.post,
);

purchaseRoutes.post(
  '/:id/cancel',
  requireRole('ADMIN'),
  validate({ params: idParamSchema }),
  purchaseController.cancel,
);
