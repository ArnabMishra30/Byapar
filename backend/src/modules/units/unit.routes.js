import { Router } from 'express';
import { requireShopPermission } from '../users/shop-permissions.js';
import * as unitController from './unit.controller.js';
import { listUnitsQuerySchema, createUnitSchema, updateUnitSchema } from './unit.validation.js';
import { validate } from '../../middlewares/validate.js';
import { requireAuth } from '../../middlewares/require-auth.js';
import { requireRole } from '../../middlewares/require-role.js';
import { idParamSchema, statusSchema } from '../../utils/validation.js';

export const unitRoutes = Router();

// Read: ADMIN and STAFF. Write: ADMIN only.
unitRoutes.use(requireAuth);

unitRoutes.get('/', validate({ query: listUnitsQuerySchema }), unitController.list);
unitRoutes.get('/:id', validate({ params: idParamSchema }), unitController.get);

unitRoutes.post('/', requireShopPermission('PRODUCTS_MANAGE'), validate({ body: createUnitSchema }), unitController.create);

unitRoutes.patch(
  '/:id',
  requireShopPermission('PRODUCTS_MANAGE'),
  validate({ params: idParamSchema, body: updateUnitSchema }),
  unitController.update,
);

unitRoutes.patch(
  '/:id/status',
  requireShopPermission('PRODUCTS_MANAGE'),
  validate({ params: idParamSchema, body: statusSchema }),
  unitController.updateStatus,
);
