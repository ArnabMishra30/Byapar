import { Router } from 'express';
import * as locationController from './storage-location.controller.js';
import {
  listLocationsQuerySchema,
  createLocationSchema,
  updateLocationSchema,
  starterLocationsSchema,
} from './storage-location.validation.js';
import { validate } from '../../middlewares/validate.js';
import { requireAuth } from '../../middlewares/require-auth.js';
import { requireRole } from '../../middlewares/require-role.js';
import { idParamSchema, statusSchema } from '../../utils/validation.js';

export const storageLocationRoutes = Router();

// Read: the shop's ADMIN and STAFF (staff pick a location when recording stock).
// Write: ADMIN only - the owner sets the layout once and everybody follows it.
storageLocationRoutes.use(requireAuth);
const shopUser = requireRole('ADMIN', 'STAFF');
const shopAdmin = requireRole('ADMIN');

storageLocationRoutes.get('/', shopUser, validate({ query: listLocationsQuerySchema }), locationController.list);
storageLocationRoutes.get('/:id', shopUser, validate({ params: idParamSchema }), locationController.get);
storageLocationRoutes.post('/', shopAdmin, validate({ body: createLocationSchema }), locationController.create);
storageLocationRoutes.post(
  '/starter',
  shopAdmin,
  validate({ body: starterLocationsSchema }),
  locationController.addStarter,
);
storageLocationRoutes.patch(
  '/:id',
  shopAdmin,
  validate({ params: idParamSchema, body: updateLocationSchema }),
  locationController.update,
);
storageLocationRoutes.patch(
  '/:id/status',
  shopAdmin,
  validate({ params: idParamSchema, body: statusSchema }),
  locationController.updateStatus,
);
