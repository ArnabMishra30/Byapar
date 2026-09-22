import { Router } from 'express';
import * as inventoryController from './inventory.controller.js';
import {
  openingStockSchema,
  adjustmentSchema,
  listInventoryQuerySchema,
  listMovementsQuerySchema,
  balanceParamsSchema,
} from './inventory.validation.js';
import { validate } from '../../middlewares/validate.js';
import { requireAuth } from '../../middlewares/require-auth.js';
import { requireRole } from '../../middlewares/require-role.js';
import { idParamSchema } from '../../utils/validation.js';

export const inventoryRoutes = Router();

// Read: ADMIN and STAFF. Write: ADMIN only.
// There is deliberately no PUT or DELETE for movements: the ledger is immutable.
inventoryRoutes.use(requireAuth);

// Movement routes are declared before /:productId/:warehouseId, because
// "/movements/<id>" would otherwise match that two-segment pattern.
inventoryRoutes.get(
  '/movements',
  validate({ query: listMovementsQuerySchema }),
  inventoryController.listMovements,
);

inventoryRoutes.get(
  '/movements/:id',
  validate({ params: idParamSchema }),
  inventoryController.getMovement,
);

inventoryRoutes.post(
  '/opening-stock',
  requireRole('ADMIN'),
  validate({ body: openingStockSchema }),
  inventoryController.createOpeningStock,
);

inventoryRoutes.post(
  '/adjustments',
  requireRole('ADMIN'),
  validate({ body: adjustmentSchema }),
  inventoryController.createAdjustment,
);

inventoryRoutes.get(
  '/',
  validate({ query: listInventoryQuerySchema }),
  inventoryController.listBalances,
);

inventoryRoutes.get(
  '/:productId/:warehouseId',
  validate({ params: balanceParamsSchema }),
  inventoryController.getBalance,
);
