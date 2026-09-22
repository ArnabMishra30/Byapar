import { Router } from 'express';
import * as platformController from './platform.controller.js';
import {
  createPlanSchema,
  updatePlanSchema,
  listPlansQuerySchema,
  createSubscriptionSchema,
  cancelSubscriptionSchema,
  recordPaymentSchema,
  listSubscriptionsQuerySchema,
  listPaymentsQuerySchema,
  onboardShopSchema,
  grantSubscriptionSchema,
  previewGrantQuerySchema,
  listShopsQuerySchema,
  createStaffSchema,
  updateStaffSchema,
  listStaffQuerySchema,
} from './platform.validation.js';
import { validate } from '../../middlewares/validate.js';
import { requireAuth } from '../../middlewares/require-auth.js';
import { requirePermission, requirePlatform } from '../../middlewares/require-role.js';
import { idParamSchema, statusSchema } from '../../utils/validation.js';
import { PERMISSION } from './permissions.js';

// THE PLATFORM'S OWN ROUTES. Not a shop's.
//
// Every route here is gated by requireAuth first and then by a PLATFORM
// permission, so a shop's ADMIN - who holds none of them - gets 403 on all of
// it. None of these routes reads req.user.companyId, because platform staff do
// not have one.
//
// Managing the plan catalogue is PLATFORM_ADMIN only: the price list is the
// operator's business, not a field rep's. Everything a rep actually does in a
// shop - register it, sell a plan, take cash - is permission-gated instead, so
// the operator can decide per person who is trusted with what.

export const planRoutes = Router();

planRoutes.use(requireAuth);

planRoutes.get(
  '/',
  requirePermission(PERMISSION.PLAN_VIEW),
  validate({ query: listPlansQuerySchema }),
  platformController.listPlans,
);

planRoutes.get(
  '/:id',
  requirePermission(PERMISSION.PLAN_VIEW),
  validate({ params: idParamSchema }),
  platformController.getPlan,
);

// Pricing is configured here. Nothing in this system hardcodes an amount.
planRoutes.post(
  '/',
  requirePlatform('PLATFORM_ADMIN'),
  validate({ body: createPlanSchema }),
  platformController.createPlan,
);

planRoutes.patch(
  '/:id',
  requirePlatform('PLATFORM_ADMIN'),
  validate({ params: idParamSchema, body: updatePlanSchema }),
  platformController.updatePlan,
);

// There is no DELETE. A plan in use is deactivated so that the subscriptions
// pointing at it keep their history.
planRoutes.patch(
  '/:id/status',
  requirePlatform('PLATFORM_ADMIN'),
  validate({ params: idParamSchema, body: statusSchema }),
  platformController.setPlanActive,
);

// --- subscriptions ---------------------------------------------------------

export const subscriptionRoutes = Router();

subscriptionRoutes.use(requireAuth);

subscriptionRoutes.get(
  '/',
  requirePermission(PERMISSION.SUBSCRIPTION_VIEW),
  validate({ query: listSubscriptionsQuerySchema }),
  platformController.listSubscriptions,
);

subscriptionRoutes.get(
  '/:id',
  requirePermission(PERMISSION.SUBSCRIPTION_VIEW),
  validate({ params: idParamSchema }),
  platformController.getSubscription,
);

subscriptionRoutes.post(
  '/',
  requirePermission(PERMISSION.SUBSCRIPTION_CREATE),
  validate({ body: createSubscriptionSchema }),
  platformController.createSubscription,
);

// Cancelling is a separate permission from selling, deliberately: a new rep may
// be trusted to sign shops up long before they are trusted to switch one off.
subscriptionRoutes.post(
  '/:id/cancel',
  requirePermission(PERMISSION.SUBSCRIPTION_CANCEL),
  validate({ params: idParamSchema, body: cancelSubscriptionSchema }),
  platformController.cancelSubscription,
);

subscriptionRoutes.get(
  '/:id/payments',
  requirePermission(PERMISSION.PAYMENT_VIEW),
  validate({ params: idParamSchema }),
  platformController.listPaymentsForSubscription,
);

subscriptionRoutes.post(
  '/:id/payments',
  requirePermission(PERMISSION.PAYMENT_CREATE),
  validate({ params: idParamSchema, body: recordPaymentSchema }),
  platformController.recordPayment,
);

// THE MANUAL RECHARGE / GRANT.
//
// Its own permission, and deliberately NOT in the sales-staff defaults: whoever
// holds SUBSCRIPTION_GRANT can give any shop free access for as long as they
// like. A PLATFORM_ADMIN passes it implicitly, as they pass everything.
//
// This is enforced HERE, on the server. Hiding the button in the admin panel is
// a courtesy to the user, not a control - anyone can post to this URL.
subscriptionRoutes.post(
  '/grant',
  requirePermission(PERMISSION.SUBSCRIPTION_GRANT),
  validate({ body: grantSubscriptionSchema }),
  platformController.grantSubscription,
);

// --- payments, across every subscription -----------------------------------

export const subscriptionPaymentRoutes = Router();

subscriptionPaymentRoutes.use(requireAuth);

subscriptionPaymentRoutes.get(
  '/',
  requirePermission(PERMISSION.PAYMENT_VIEW),
  validate({ query: listPaymentsQuerySchema }),
  platformController.listPayments,
);

// --- shops -----------------------------------------------------------------

export const businessRoutes = Router();

businessRoutes.use(requireAuth);

businessRoutes.get(
  '/',
  requirePermission(PERMISSION.BUSINESS_VIEW),
  validate({ query: listShopsQuerySchema }),
  platformController.listShops,
);

businessRoutes.get(
  '/:id',
  requirePermission(PERMISSION.BUSINESS_VIEW),
  validate({ params: idParamSchema }),
  platformController.getShop,
);

// The single action a field rep performs: company, owner login, chart of
// accounts, subscription and cash, in one transaction.
businessRoutes.post(
  '/onboard',
  requirePermission(PERMISSION.BUSINESS_CREATE),
  validate({ body: onboardShopSchema }),
  platformController.onboardShop,
);

businessRoutes.patch(
  '/:id/status',
  requirePermission(PERMISSION.BUSINESS_EDIT),
  validate({ params: idParamSchema, body: statusSchema }),
  platformController.setShopActive,
);

// What a recharge would do, before anybody commits to it.
businessRoutes.get(
  '/:id/recharge-preview',
  requirePermission(PERMISSION.SUBSCRIPTION_VIEW),
  validate({ params: idParamSchema, query: previewGrantQuerySchema }),
  platformController.previewGrant,
);

// The audit trail: every subscription and every payment this shop has had,
// including who granted what and why.
businessRoutes.get(
  '/:id/history',
  requirePermission(PERMISSION.SUBSCRIPTION_VIEW),
  validate({ params: idParamSchema }),
  platformController.getBusinessHistory,
);

// --- sales team ------------------------------------------------------------

export const salesTeamRoutes = Router();

salesTeamRoutes.use(requireAuth);

// Hiring, firing and granting permissions is the operator's job alone. A rep
// must never be able to widen their own permissions.
salesTeamRoutes.use(requirePlatform('PLATFORM_ADMIN'));

// Declared before /:id so "permissions" is never read as a staff id.
salesTeamRoutes.get('/permissions', platformController.listPermissions);

salesTeamRoutes.get('/', validate({ query: listStaffQuerySchema }), platformController.listStaff);

salesTeamRoutes.get('/:id', validate({ params: idParamSchema }), platformController.getStaff);

salesTeamRoutes.post('/', validate({ body: createStaffSchema }), platformController.createStaff);

salesTeamRoutes.patch(
  '/:id',
  validate({ params: idParamSchema, body: updateStaffSchema }),
  platformController.updateStaff,
);
