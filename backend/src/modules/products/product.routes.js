import { Router } from 'express';
import * as productController from './product.controller.js';
import {
  listProductsQuerySchema,
  createProductSchema,
  updateProductSchema,
} from './product.validation.js';
import { validate } from '../../middlewares/validate.js';
import { requireAuth } from '../../middlewares/require-auth.js';
import { requireRole } from '../../middlewares/require-role.js';
import { idParamSchema, statusSchema } from '../../utils/validation.js';

export const productRoutes = Router();

// Read: ADMIN and STAFF. Write: ADMIN only.
productRoutes.use(requireAuth);

productRoutes.get('/', validate({ query: listProductsQuerySchema }), productController.list);
productRoutes.get('/:id', validate({ params: idParamSchema }), productController.get);

productRoutes.post(
  '/',
  requireRole('ADMIN'),
  validate({ body: createProductSchema }),
  productController.create,
);

productRoutes.patch(
  '/:id',
  requireRole('ADMIN'),
  validate({ params: idParamSchema, body: updateProductSchema }),
  productController.update,
);

productRoutes.patch(
  '/:id/status',
  requireRole('ADMIN'),
  validate({ params: idParamSchema, body: statusSchema }),
  productController.updateStatus,
);
