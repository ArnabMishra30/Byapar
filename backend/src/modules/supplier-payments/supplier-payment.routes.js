import { Router } from 'express';
import * as supplierPaymentController from './supplier-payment.controller.js';
import {
  createSupplierPaymentSchema,
  updateSupplierPaymentSchema,
  listSupplierPaymentsQuerySchema,
} from './supplier-payment.validation.js';
import { validate } from '../../middlewares/validate.js';
import { requireAuth } from '../../middlewares/require-auth.js';
import { requireRole } from '../../middlewares/require-role.js';
import { idParamSchema } from '../../utils/validation.js';

export const supplierPaymentRoutes = Router();

// Read: ADMIN and STAFF. Money movement (create, edit, post, cancel): ADMIN only.
// There is no DELETE: a draft is cancelled, and a posted payment is permanent.
supplierPaymentRoutes.use(requireAuth);

supplierPaymentRoutes.get(
  '/',
  validate({ query: listSupplierPaymentsQuerySchema }),
  supplierPaymentController.list,
);

supplierPaymentRoutes.get(
  '/:id',
  validate({ params: idParamSchema }),
  supplierPaymentController.get,
);

supplierPaymentRoutes.post(
  '/',
  requireRole('ADMIN'),
  validate({ body: createSupplierPaymentSchema }),
  supplierPaymentController.create,
);

supplierPaymentRoutes.patch(
  '/:id',
  requireRole('ADMIN'),
  validate({ params: idParamSchema, body: updateSupplierPaymentSchema }),
  supplierPaymentController.update,
);

supplierPaymentRoutes.post(
  '/:id/post',
  requireRole('ADMIN'),
  validate({ params: idParamSchema }),
  supplierPaymentController.post,
);

supplierPaymentRoutes.post(
  '/:id/cancel',
  requireRole('ADMIN'),
  validate({ params: idParamSchema }),
  supplierPaymentController.cancel,
);
