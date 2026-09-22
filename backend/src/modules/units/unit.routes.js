import { Router } from 'express';
import * as unitController from './unit.controller.js';
import { listUnitsQuerySchema, createUnitSchema, updateUnitSchema } from './unit.validation.js';
import { validate } from '../../middlewares/validate.js';
import { requireAuth } from '../../middlewares/require-auth.js';
import { requireRole } from '../../middlewares/require-role.js';
import { idParamSchema, statusSchema } from '../../utils/validation.js';

export const unitRoutes = Router();

// Read: ADMIN and STAFF. Write: ADMIN only.
unitRoutes.use(requireAuth);

unitRoutes.get('/', validate({ query: listUnitsQuerySchema }), unitController.list);
unitRoutes.get('/:id', validate({ params: idParamSchema }), unitController.get);

unitRoutes.post('/', requireRole('ADMIN'), validate({ body: createUnitSchema }), unitController.create);

unitRoutes.patch(
  '/:id',
  requireRole('ADMIN'),
  validate({ params: idParamSchema, body: updateUnitSchema }),
  unitController.update,
);

unitRoutes.patch(
  '/:id/status',
  requireRole('ADMIN'),
  validate({ params: idParamSchema, body: statusSchema }),
  unitController.updateStatus,
);
