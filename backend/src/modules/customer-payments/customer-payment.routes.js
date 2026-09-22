import { Router } from 'express';
import * as customerPaymentController from './customer-payment.controller.js';
import {
  createCustomerPaymentSchema,
  updateCustomerPaymentSchema,
  listCustomerPaymentsQuerySchema,
} from './customer-payment.validation.js';
import { validate } from '../../middlewares/validate.js';
import { requireAuth } from '../../middlewares/require-auth.js';
import { requireRole } from '../../middlewares/require-role.js';
import { idParamSchema } from '../../utils/validation.js';

export const customerPaymentRoutes = Router();

// Read: ADMIN and STAFF. Money movement: ADMIN only, matching the RBAC already
// used for supplier payments.
// There is no DELETE: a draft is cancelled, a posted payment is permanent.
customerPaymentRoutes.use(requireAuth);

customerPaymentRoutes.get(
  '/',
  validate({ query: listCustomerPaymentsQuerySchema }),
  customerPaymentController.list,
);

customerPaymentRoutes.get(
  '/:id',
  validate({ params: idParamSchema }),
  customerPaymentController.get,
);

customerPaymentRoutes.post(
  '/',
  requireRole('ADMIN'),
  validate({ body: createCustomerPaymentSchema }),
  customerPaymentController.create,
);

customerPaymentRoutes.patch(
  '/:id',
  requireRole('ADMIN'),
  validate({ params: idParamSchema, body: updateCustomerPaymentSchema }),
  customerPaymentController.update,
);

customerPaymentRoutes.post(
  '/:id/post',
  requireRole('ADMIN'),
  validate({ params: idParamSchema }),
  customerPaymentController.post,
);

customerPaymentRoutes.post(
  '/:id/cancel',
  requireRole('ADMIN'),
  validate({ params: idParamSchema }),
  customerPaymentController.cancel,
);
