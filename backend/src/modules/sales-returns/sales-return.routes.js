import { Router } from 'express';
import * as salesReturnController from './sales-return.controller.js';
import {
  createSalesReturnSchema,
  updateSalesReturnSchema,
  listSalesReturnsQuerySchema,
  returnableInvoiceParamsSchema,
} from './sales-return.validation.js';
import { validate } from '../../middlewares/validate.js';
import { requireAuth } from '../../middlewares/require-auth.js';
import { requireRole } from '../../middlewares/require-role.js';
import { idParamSchema } from '../../utils/validation.js';

export const salesReturnRoutes = Router();

// Read and draft handling: ADMIN and STAFF, matching purchase returns and sales.
// Posting and cancelling (the state changes that move stock and money): ADMIN.
// There is no DELETE: a draft is cancelled, a posted return is permanent.
salesReturnRoutes.use(requireAuth);

// Declared before /:id so "returnable" is never read as a return id.
salesReturnRoutes.get(
  '/returnable/:salesInvoiceId',
  validate({ params: returnableInvoiceParamsSchema }),
  salesReturnController.returnableLines,
);

salesReturnRoutes.get(
  '/',
  validate({ query: listSalesReturnsQuerySchema }),
  salesReturnController.list,
);

salesReturnRoutes.get('/:id', validate({ params: idParamSchema }), salesReturnController.get);

salesReturnRoutes.post(
  '/',
  validate({ body: createSalesReturnSchema }),
  salesReturnController.create,
);

salesReturnRoutes.patch(
  '/:id',
  validate({ params: idParamSchema, body: updateSalesReturnSchema }),
  salesReturnController.update,
);

salesReturnRoutes.post(
  '/:id/post',
  requireRole('ADMIN'),
  validate({ params: idParamSchema }),
  salesReturnController.post,
);

salesReturnRoutes.post(
  '/:id/cancel',
  requireRole('ADMIN'),
  validate({ params: idParamSchema }),
  salesReturnController.cancel,
);
