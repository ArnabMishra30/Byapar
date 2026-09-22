import { Router } from 'express';
import * as supplierController from './supplier.controller.js';
import {
  listSuppliersQuerySchema,
  createSupplierSchema,
  updateSupplierSchema,
} from './supplier.validation.js';
import { validate } from '../../middlewares/validate.js';
import { requireAuth } from '../../middlewares/require-auth.js';
import { requireRole } from '../../middlewares/require-role.js';
import { idParamSchema, statusSchema } from '../../utils/validation.js';

export const supplierRoutes = Router();

// Read: ADMIN and STAFF. Write: ADMIN only.
supplierRoutes.use(requireAuth);

supplierRoutes.get('/', validate({ query: listSuppliersQuerySchema }), supplierController.list);
supplierRoutes.get('/:id', validate({ params: idParamSchema }), supplierController.get);

supplierRoutes.post(
  '/',
  requireRole('ADMIN'),
  validate({ body: createSupplierSchema }),
  supplierController.create,
);

supplierRoutes.patch(
  '/:id',
  requireRole('ADMIN'),
  validate({ params: idParamSchema, body: updateSupplierSchema }),
  supplierController.update,
);

supplierRoutes.patch(
  '/:id/status',
  requireRole('ADMIN'),
  validate({ params: idParamSchema, body: statusSchema }),
  supplierController.updateStatus,
);
