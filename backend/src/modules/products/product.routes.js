import { Router } from 'express';
import { requireShopPermission } from '../users/shop-permissions.js';
import * as productController from './product.controller.js';
import {
  listProductsQuerySchema,
  createProductSchema,
  updateProductSchema,
  onTheSpotComboSchema,
} from './product.validation.js';
import { validate } from '../../middlewares/validate.js';
import { requireAuth } from '../../middlewares/require-auth.js';
import { requireRole } from '../../middlewares/require-role.js';
import { idParamSchema, statusSchema } from '../../utils/validation.js';
import { sendSuccess } from '../../utils/response.js';
import * as productService from './product.service.js';

export const productRoutes = Router();

// Read: ADMIN and STAFF. Write: ADMIN only.
productRoutes.use(requireAuth);

productRoutes.get('/', validate({ query: listProductsQuerySchema }), productController.list);
productRoutes.get('/:id', validate({ params: idParamSchema }), productController.get);

// A combo made while billing: anyone who can bill. Saving it for later also
// needs PRODUCTS_MANAGE (checked in the service).
productRoutes.post(
  '/combos/on-the-spot',
  requireShopPermission('SALES_CREATE', 'SALES_POST', 'PRODUCTS_MANAGE'),
  validate({ body: onTheSpotComboSchema }),
  async (req, res) => {
    const product = await productService.createOnTheSpotCombo(req.user, req.validated.body);
    return sendSuccess(res, { product }, 201, 'Combo created');
  },
);

productRoutes.post(
  '/',
  requireShopPermission('PRODUCTS_MANAGE'),
  validate({ body: createProductSchema }),
  productController.create,
);

productRoutes.patch(
  '/:id',
  requireShopPermission('PRODUCTS_MANAGE'),
  validate({ params: idParamSchema, body: updateProductSchema }),
  productController.update,
);

productRoutes.patch(
  '/:id/status',
  requireShopPermission('PRODUCTS_MANAGE'),
  validate({ params: idParamSchema, body: statusSchema }),
  productController.updateStatus,
);
