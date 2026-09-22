import { Router } from 'express';
import * as warehouseController from './warehouse.controller.js';
import {
  listWarehousesQuerySchema,
  createWarehouseSchema,
  updateWarehouseSchema,
} from './warehouse.validation.js';
import { validate } from '../../middlewares/validate.js';
import { requireAuth } from '../../middlewares/require-auth.js';
import { requireRole } from '../../middlewares/require-role.js';
import { idParamSchema, statusSchema } from '../../utils/validation.js';

export const warehouseRoutes = Router();

// Read: ADMIN and STAFF. Write: ADMIN only.
warehouseRoutes.use(requireAuth);

warehouseRoutes.get('/', validate({ query: listWarehousesQuerySchema }), warehouseController.list);
warehouseRoutes.get('/:id', validate({ params: idParamSchema }), warehouseController.get);

warehouseRoutes.post(
  '/',
  requireRole('ADMIN'),
  validate({ body: createWarehouseSchema }),
  warehouseController.create,
);

warehouseRoutes.patch(
  '/:id',
  requireRole('ADMIN'),
  validate({ params: idParamSchema, body: updateWarehouseSchema }),
  warehouseController.update,
);

warehouseRoutes.patch(
  '/:id/status',
  requireRole('ADMIN'),
  validate({ params: idParamSchema, body: statusSchema }),
  warehouseController.updateStatus,
);
