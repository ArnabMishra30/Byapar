import { ApiError } from '../utils/api-error.js';

/**
 * Allows the request only if the authenticated user has one of the given roles.
 * Must be used after requireAuth.
 *
 *   router.post('/', requireAuth, requireRole('ADMIN'), controller.create)
 *
 * Roles come from req.user, which requireAuth loaded from the database - never
 * from the JWT payload alone.
 *
 * When granular permissions are introduced later, add a requirePermission()
 * helper next to this one. Route definitions change; controllers do not.
 *
 * @param {...('ADMIN'|'STAFF')} allowedRoles
 */
export function requireRole(...allowedRoles) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(ApiError.unauthorized('Authentication required'));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(ApiError.forbidden('You do not have permission to perform this action'));
    }

    return next();
  };
}

/**
 * Allows the request only if the :companyId route parameter matches the
 * authenticated user's company.
 *
 * This exists for routes that name a company in the URL. Routes that do not name
 * one should simply read req.user.companyId - that is the normal pattern.
 *
 * @param {string} [paramName='companyId']
 */
export function requireCompanyAccess(paramName = 'companyId') {
  return (req, _res, next) => {
    if (!req.user) {
      return next(ApiError.unauthorized('Authentication required'));
    }

    const requestedCompanyId = req.params[paramName];

    if (requestedCompanyId !== req.user.companyId) {
      // 404 rather than 403: a user must not be able to discover which company
      // ids exist by comparing error codes.
      return next(ApiError.notFound('Company not found'));
    }

    return next();
  };
}

/**
 * Allows the request only if the user holds a PLATFORM permission.
 *
 * This is the helper the note above anticipated. It is for the SaaS operator's
 * own routes - plans, sales staff, shop onboarding, subscriptions - and it has
 * no bearing on a shop's own accounting routes, which continue to use
 * requireRole('ADMIN') exactly as before.
 *
 * A PLATFORM_ADMIN passes everything. A SALES_STAFF member passes what is in
 * their own permission list. A shop's ADMIN passes nothing here, which is
 * correct: running a shop is not the same job as running the platform.
 *
 *   router.post('/', requireAuth, requirePermission('BUSINESS_CREATE'), controller.create)
 *
 * @param {...string} required
 */
export function requirePermission(...required) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(ApiError.unauthorized('Authentication required'));
    }

    if (req.user.role === 'PLATFORM_ADMIN') return next();

    const held = Array.isArray(req.user.permissions) ? req.user.permissions : [];
    const missing = required.filter((permission) => !held.includes(permission));

    if (missing.length > 0) {
      return next(
        ApiError.forbidden('You do not have permission to perform this action'),
      );
    }

    return next();
  };
}

/**
 * Allows only the SaaS operator's own people onto a route.
 *
 * Used where a permission list is not the question - a platform dashboard, say -
 * and the answer is simply "is this one of ours?".
 */
export function requirePlatform(...allowedRoles) {
  const allowed = allowedRoles.length > 0 ? allowedRoles : ['PLATFORM_ADMIN', 'SALES_STAFF'];

  return (req, _res, next) => {
    if (!req.user) {
      return next(ApiError.unauthorized('Authentication required'));
    }
    if (!allowed.includes(req.user.role)) {
      return next(ApiError.forbidden('You do not have permission to perform this action'));
    }
    return next();
  };
}
