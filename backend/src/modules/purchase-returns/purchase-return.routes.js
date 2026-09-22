import { Router } from 'express';
import * as purchaseReturnController from './purchase-return.controller.js';
import {
  createPurchaseReturnSchema,
  updatePurchaseReturnSchema,
  listPurchaseReturnsQuerySchema,
  returnablePurchaseParamsSchema,
} from './purchase-return.validation.js';
import { validate } from '../../middlewares/validate.js';
import { requireAuth } from '../../middlewares/require-auth.js';
import { requireRole } from '../../middlewares/require-role.js';
import { idParamSchema } from '../../utils/validation.js';

export const purchaseReturnRoutes = Router();

// Read and draft handling: ADMIN and STAFF.
// Posting and cancelling (the state changes that move stock): ADMIN only.
// There is no DELETE: a draft is cancelled, and a posted return is permanent.
purchaseReturnRoutes.use(requireAuth);

// Declared before /:id so "returnable" is never read as a return id.
purchaseReturnRoutes.get(
  '/returnable/:purchaseId',
  validate({ params: returnablePurchaseParamsSchema }),
  purchaseReturnController.returnableLines,
);

purchaseReturnRoutes.get(
  '/',
  validate({ query: listPurchaseReturnsQuerySchema }),
  purchaseReturnController.list,
);

purchaseReturnRoutes.get('/:id', validate({ params: idParamSchema }), purchaseReturnController.get);

purchaseReturnRoutes.post(
  '/',
  validate({ body: createPurchaseReturnSchema }),
  purchaseReturnController.create,
);

purchaseReturnRoutes.patch(
  '/:id',
  validate({ params: idParamSchema, body: updatePurchaseReturnSchema }),
  purchaseReturnController.update,
);

purchaseReturnRoutes.post(
  '/:id/post',
  requireRole('ADMIN'),
  validate({ params: idParamSchema }),
  purchaseReturnController.post,
);

purchaseReturnRoutes.post(
  '/:id/cancel',
  requireRole('ADMIN'),
  validate({ params: idParamSchema }),
  purchaseReturnController.cancel,
);
