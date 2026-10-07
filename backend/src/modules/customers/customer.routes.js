import { Router } from 'express';
import { requireShopPermission } from '../users/shop-permissions.js';
import * as customerController from './customer.controller.js';
import {
  listCustomersQuerySchema,
  createCustomerSchema,
  updateCustomerSchema,
} from './customer.validation.js';
import { validate } from '../../middlewares/validate.js';
import { requireAuth } from '../../middlewares/require-auth.js';
import { requireRole } from '../../middlewares/require-role.js';
import { idParamSchema, statusSchema } from '../../utils/validation.js';

export const customerRoutes = Router();

// Read: ADMIN and STAFF. Write: ADMIN only.
customerRoutes.use(requireAuth);

customerRoutes.get('/', validate({ query: listCustomersQuerySchema }), customerController.list);
customerRoutes.get('/:id', validate({ params: idParamSchema }), customerController.get);

customerRoutes.post(
  '/',
  requireShopPermission('PARTIES_MANAGE'),
  validate({ body: createCustomerSchema }),
  customerController.create,
);

customerRoutes.patch(
  '/:id',
  requireShopPermission('PARTIES_MANAGE'),
  validate({ params: idParamSchema, body: updateCustomerSchema }),
  customerController.update,
);

customerRoutes.patch(
  '/:id/status',
  requireShopPermission('PARTIES_MANAGE'),
  validate({ params: idParamSchema, body: statusSchema }),
  customerController.updateStatus,
);
