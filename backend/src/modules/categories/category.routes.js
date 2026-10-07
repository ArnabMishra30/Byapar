import { Router } from 'express';
import { requireShopPermission } from '../users/shop-permissions.js';
import * as categoryController from './category.controller.js';
import {
  listCategoriesQuerySchema,
  createCategorySchema,
  updateCategorySchema,
} from './category.validation.js';
import { validate } from '../../middlewares/validate.js';
import { requireAuth } from '../../middlewares/require-auth.js';
import { requireRole } from '../../middlewares/require-role.js';
import { idParamSchema, statusSchema } from '../../utils/validation.js';

export const categoryRoutes = Router();

// Read: ADMIN and STAFF. Write: ADMIN only.
categoryRoutes.use(requireAuth);

categoryRoutes.get('/', validate({ query: listCategoriesQuerySchema }), categoryController.list);
categoryRoutes.get('/:id', validate({ params: idParamSchema }), categoryController.get);

categoryRoutes.post(
  '/',
  requireShopPermission('PRODUCTS_MANAGE'),
  validate({ body: createCategorySchema }),
  categoryController.create,
);

categoryRoutes.patch(
  '/:id',
  requireShopPermission('PRODUCTS_MANAGE'),
  validate({ params: idParamSchema, body: updateCategorySchema }),
  categoryController.update,
);

categoryRoutes.patch(
  '/:id/status',
  requireShopPermission('PRODUCTS_MANAGE'),
  validate({ params: idParamSchema, body: statusSchema }),
  categoryController.updateStatus,
);
