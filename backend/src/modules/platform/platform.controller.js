import * as subscriptionService from './subscription.service.js';
import * as onboardingService from './onboarding.service.js';
import { sendSuccess, sendPaginated } from '../../utils/response.js';
import { ALL_PERMISSIONS, DEFAULT_SALES_STAFF_PERMISSIONS } from './permissions.js';

// HTTP only. No business rules, no Prisma.

// --- plans -----------------------------------------------------------------

export async function listPlans(req, res) {
  const { plans, pagination } = await subscriptionService.listPlans(req.validated.query);
  return sendPaginated(res, plans, pagination);
}

export async function getPlan(req, res) {
  const plan = await subscriptionService.getPlan(req.validated.params.id);
  return sendSuccess(res, { plan });
}

export async function createPlan(req, res) {
  const plan = await subscriptionService.createPlan(req.body);
  return sendSuccess(res, { plan }, 201, 'Plan created successfully');
}

export async function updatePlan(req, res) {
  const plan = await subscriptionService.updatePlan(req.validated.params.id, req.body);
  return sendSuccess(res, { plan }, 200, 'Plan updated successfully');
}

/** Plans are deactivated, never deleted - subscriptions reference them. */
export async function setPlanActive(req, res) {
  const plan = await subscriptionService.setPlanActive(req.validated.params.id, req.body.isActive);
  return sendSuccess(res, { plan }, 200, `Plan ${req.body.isActive ? 'activated' : 'deactivated'}`);
}

// --- subscriptions ---------------------------------------------------------

export async function listSubscriptions(req, res) {
  const { subscriptions, pagination } = await subscriptionService.listSubscriptions(
    req.validated.query,
  );
  return sendPaginated(res, subscriptions, pagination);
}

export async function getSubscription(req, res) {
  const subscription = await subscriptionService.getSubscription(req.validated.params.id);
  return sendSuccess(res, { subscription });
}

export async function createSubscription(req, res) {
  // The service already returns { subscription, payment } - selling a plan and
  // taking the money are one action, so the response carries both.
  const result = await subscriptionService.createSubscription(req.user, req.body);
  return sendSuccess(res, result, 201, 'Subscription created successfully');
}

export async function cancelSubscription(req, res) {
  const subscription = await subscriptionService.cancelSubscription(
    req.user,
    req.validated.params.id,
    req.body,
  );
  return sendSuccess(res, { subscription }, 200, 'Subscription cancelled');
}

// --- payments --------------------------------------------------------------

export async function recordPayment(req, res) {
  const payment = await subscriptionService.recordPayment(
    req.user,
    req.validated.params.id,
    req.body,
  );
  return sendSuccess(res, { payment }, 201, 'Payment recorded successfully');
}

export async function listPaymentsForSubscription(req, res) {
  const payments = await subscriptionService.listPaymentsForSubscription(req.validated.params.id);
  return sendSuccess(res, { payments });
}

export async function listPayments(req, res) {
  const { payments, pagination } = await subscriptionService.listPayments(req.validated.query);
  return sendPaginated(res, payments, pagination);
}

// --- shops -----------------------------------------------------------------

export async function onboardShop(req, res) {
  const result = await onboardingService.onboardShop(req.user, req.body);
  return sendSuccess(res, result, 201, 'Business registered successfully');
}

export async function listShops(req, res) {
  const { businesses, pagination } = await onboardingService.listShops(
    req.user,
    req.validated.query,
  );
  return sendPaginated(res, businesses, pagination);
}

export async function getShop(req, res) {
  const business = await onboardingService.getShop(req.validated.params.id);
  return sendSuccess(res, { business });
}

export async function setShopActive(req, res) {
  const business = await onboardingService.setShopActive(
    req.validated.params.id,
    req.body.isActive,
  );
  return sendSuccess(
    res,
    { business },
    200,
    `Business ${req.body.isActive ? 'activated' : 'deactivated'}`,
  );
}

// --- manual grants and recharges -------------------------------------------

/** An admin gives a shop a subscription by hand. No gateway involved. */
export async function grantSubscription(req, res) {
  const result = await subscriptionService.grantSubscription(req.user, req.body);
  return sendSuccess(res, result, 201, 'Subscription granted');
}

/** What a recharge WOULD do, so the dialog can show it before anybody commits. */
export async function previewGrant(req, res) {
  const preview = await subscriptionService.previewGrant(
    req.validated.params.id,
    req.validated.query,
  );
  return sendSuccess(res, { preview });
}

/** A shop's full subscription and payment history - the audit trail. */
export async function getBusinessHistory(req, res) {
  const history = await subscriptionService.getCompanyHistory(req.validated.params.id);
  return sendSuccess(res, history);
}

// --- sales team ------------------------------------------------------------

export async function listStaff(req, res) {
  const { staff, pagination } = await onboardingService.listStaff(req.validated.query);
  return sendPaginated(res, staff, pagination);
}

export async function getStaff(req, res) {
  const staff = await onboardingService.getStaff(req.validated.params.id);
  return sendSuccess(res, { staff });
}

export async function createStaff(req, res) {
  const staff = await onboardingService.createStaff(req.body);
  return sendSuccess(res, { staff }, 201, 'Staff member created successfully');
}

export async function updateStaff(req, res) {
  const staff = await onboardingService.updateStaff(req.validated.params.id, req.body);
  return sendSuccess(res, { staff }, 200, 'Staff member updated successfully');
}

/** The permission catalogue, so a form never hardcodes the list. */
export async function listPermissions(_req, res) {
  return sendSuccess(res, {
    permissions: ALL_PERMISSIONS,
    defaults: DEFAULT_SALES_STAFF_PERMISSIONS,
  });
}
