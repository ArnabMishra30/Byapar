import { Router } from 'express';
import { requireShopPermission } from '../users/shop-permissions.js';
import * as salesController from './sales.controller.js';
import {
  createSaleSchema,
  updateSaleSchema,
  listSalesQuerySchema,
  postSaleSchema,
} from './sales.validation.js';
import { validate } from '../../middlewares/validate.js';
import { requireAuth } from '../../middlewares/require-auth.js';
import { requireRole } from '../../middlewares/require-role.js';
import { idParamSchema } from '../../utils/validation.js';

export const salesRoutes = Router();

// Read and draft handling: ADMIN and STAFF - a counter clerk raises invoices.
// Posting and cancelling (the state changes that move stock and money): ADMIN.
// There is no DELETE: a draft is cancelled, a posted invoice is permanent.
salesRoutes.use(requireAuth);

salesRoutes.get('/', validate({ query: listSalesQuerySchema }), salesController.list);
salesRoutes.get('/:id', validate({ params: idParamSchema }), salesController.get);

salesRoutes.post('/', requireShopPermission('SALES_CREATE', 'SALES_POST'), validate({ body: createSaleSchema }), salesController.create);

salesRoutes.patch(
  '/:id',
  requireShopPermission('SALES_CREATE', 'SALES_POST'),
  validate({ params: idParamSchema, body: updateSaleSchema }),
  salesController.update,
);

// The body is optional and carries only the credit-limit override. Posting was
// already ADMIN-only, so the override inherits that restriction rather than
// introducing a permission of its own.
salesRoutes.post(
  '/:id/post',
  requireShopPermission('SALES_POST'),
  validate({ params: idParamSchema, body: postSaleSchema }),
  salesController.post,
);

salesRoutes.post(
  '/:id/cancel',
  // Cancelling a draft: anyone who may complete sales (a cashier, for their own
  // drafts) or undo them. A completed sale is reversed with a sales return.
  // Old staff accounts (drafts only) still cannot cancel, as before.
  requireShopPermission('SALES_POST', 'SALES_CANCEL'),
  validate({ params: idParamSchema }),
  salesController.cancel,
);
