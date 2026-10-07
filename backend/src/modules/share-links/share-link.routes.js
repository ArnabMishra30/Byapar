import { Router } from 'express';
import { requireShopPermission } from '../users/shop-permissions.js';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import * as shareLinkService from './share-link.service.js';
import { validate } from '../../middlewares/validate.js';
import { requireAuth } from '../../middlewares/require-auth.js';
import { requireRole } from '../../middlewares/require-role.js';
import { idParamSchema, optionalIdQuerySchema } from '../../utils/validation.js';
import { sendSuccess } from '../../utils/response.js';
import { isTest } from '../../config/env.js';

// --- owner side: /api/v1/share-links ---------------------------------------------

const createShareLinkSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('INVOICE'),
    salesInvoiceId: z.string().uuid('Invalid salesInvoiceId'),
    includeAccount: z.boolean().optional().default(false),
  }).strict(),
  z.object({ kind: z.literal('CUSTOMER_ACCOUNT'), customerId: z.string().uuid('Invalid customerId') }).strict(),
  z.object({ kind: z.literal('SUPPLIER_ACCOUNT'), supplierId: z.string().uuid('Invalid supplierId') }).strict(),
]);

const listShareLinksQuerySchema = z.object({
  salesInvoiceId: optionalIdQuerySchema('salesInvoiceId'),
  customerId: optionalIdQuerySchema('customerId'),
  supplierId: optionalIdQuerySchema('supplierId'),
});

export const shareLinkRoutes = Router();

// Sharing hands the shop's figures to someone outside it, so creating and
// stopping a link is the owner's (ADMIN) call. Staff may see which links exist.
shareLinkRoutes.use(requireAuth);

shareLinkRoutes.get(
  '/',
  requireRole('ADMIN', 'STAFF'),
  validate({ query: listShareLinksQuerySchema }),
  async (req, res) => sendSuccess(res, { links: await shareLinkService.list(req.user, req.validated.query) }),
);

shareLinkRoutes.post('/', requireShopPermission('SHARE_LINKS'), validate({ body: createShareLinkSchema }), async (req, res) => {
  const { link, created } = await shareLinkService.create(req.user, req.validated.body);
  return sendSuccess(res, { link }, created ? 201 : 200, created ? 'Share link created' : 'Existing share link');
});

shareLinkRoutes.post(
  '/:id/revoke',
  requireShopPermission('SHARE_LINKS'),
  validate({ params: idParamSchema }),
  async (req, res) =>
    sendSuccess(res, { link: await shareLinkService.revoke(req.user, req.validated.params.id) }, 200, 'Sharing stopped'),
);

// --- recipient side: /api/v1/public/share --------------------------------------
//
// NO LOGIN, by design. The token is the only key. A stricter per-IP limit than
// the global one makes guessing tokens pointless as well as impossible.

const tokenParamSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{32}$/, 'Invalid link'),
});

export const publicShareRoutes = Router();

if (!isTest) {
  publicShareRoutes.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: 60,
      standardHeaders: true,
      legacyHeaders: false,
      message: { success: false, message: 'Too many requests, please try again in a minute' },
    }),
  );
}

// A shared page must never be cached by a proxy or shown to the next user of
// the same phone's browser history from cache after sharing is stopped.
publicShareRoutes.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
});

publicShareRoutes.get('/:token', validate({ params: tokenParamSchema }), async (req, res) =>
  sendSuccess(res, await shareLinkService.view(req.validated.params.token)),
);

publicShareRoutes.get(
  '/:token/invoices/:id',
  validate({ params: tokenParamSchema.extend({ id: z.string().uuid('Invalid id') }) }),
  async (req, res) =>
    sendSuccess(res, {
      invoice: await shareLinkService.viewInvoice(req.validated.params.token, req.validated.params.id),
    }),
);
