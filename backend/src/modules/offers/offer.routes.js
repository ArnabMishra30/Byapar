import { Router } from 'express';
import { z } from 'zod';
import * as offerService from './offer.service.js';
import { validate } from '../../middlewares/validate.js';
import { requireAuth } from '../../middlewares/require-auth.js';
import { requireRole } from '../../middlewares/require-role.js';
import { requireShopPermission } from '../users/shop-permissions.js';
import { idParamSchema, statusSchema } from '../../utils/validation.js';
import { sendSuccess } from '../../utils/response.js';

export const offerRoutes = Router();

// Anyone at the shop may see the offers (a cashier needs to know them); setting
// them up is for whoever manages products.
offerRoutes.use(requireAuth);

offerRoutes.get(
  '/',
  requireRole('ADMIN', 'STAFF'),
  validate({ query: z.object({ active: z.enum(['true', 'false']).optional() }) }),
  async (req, res) =>
    sendSuccess(res, { offers: await offerService.list(req.user, { activeOnly: req.validated.query.active === 'true' }) }),
);

offerRoutes.post('/', requireShopPermission('PRODUCTS_MANAGE'), validate({ body: offerService.offerBodySchema }), async (req, res) =>
  sendSuccess(res, { offer: await offerService.create(req.user, req.validated.body) }, 201, 'Offer created'),
);

offerRoutes.patch(
  '/:id/status',
  requireShopPermission('PRODUCTS_MANAGE'),
  validate({ params: idParamSchema, body: statusSchema }),
  async (req, res) =>
    sendSuccess(res, { offer: await offerService.setStatus(req.user, req.validated.params.id, req.validated.body.isActive) }),
);
