import { Router } from 'express';
import * as taxController from './tax.controller.js';
import { listTaxesQuerySchema, createTaxSchema, updateTaxSchema } from './tax.validation.js';
import { validate } from '../../middlewares/validate.js';
import { requireAuth } from '../../middlewares/require-auth.js';
import { requireRole } from '../../middlewares/require-role.js';
import { idParamSchema, statusSchema } from '../../utils/validation.js';

export const taxRoutes = Router();

// Read: ADMIN and STAFF. Write: ADMIN only.
taxRoutes.use(requireAuth);

taxRoutes.get('/', validate({ query: listTaxesQuerySchema }), taxController.list);
taxRoutes.get('/:id', validate({ params: idParamSchema }), taxController.get);

taxRoutes.post('/', requireRole('ADMIN'), validate({ body: createTaxSchema }), taxController.create);

taxRoutes.patch(
  '/:id',
  requireRole('ADMIN'),
  validate({ params: idParamSchema, body: updateTaxSchema }),
  taxController.update,
);

taxRoutes.patch(
  '/:id/status',
  requireRole('ADMIN'),
  validate({ params: idParamSchema, body: statusSchema }),
  taxController.updateStatus,
);
