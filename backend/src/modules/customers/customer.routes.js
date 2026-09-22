import { Router } from 'express';
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
  requireRole('ADMIN'),
  validate({ body: createCustomerSchema }),
  customerController.create,
);

customerRoutes.patch(
  '/:id',
  requireRole('ADMIN'),
  validate({ params: idParamSchema, body: updateCustomerSchema }),
  customerController.update,
);

customerRoutes.patch(
  '/:id/status',
  requireRole('ADMIN'),
  validate({ params: idParamSchema, body: statusSchema }),
  customerController.updateStatus,
);
