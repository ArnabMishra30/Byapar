import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { ApiError } from '../utils/api-error.js';
import * as authRepository from '../modules/auth/auth.repository.js';

/**
 * The authenticated request context.
 * @typedef {object} AuthUser
 * @property {string} id
 * @property {string} email
 * @property {string} name
 * @property {'ADMIN'|'STAFF'} role
 * @property {string} companyId  Tenant of the user. Always taken from here, never from the request.
 */

/**
 * Reads "Authorization: Bearer <token>", verifies it, and loads the user.
 *
 * The token is only used to identify WHICH user is calling. Role, company and
 * active status are re-read from the database on every request, so a deactivated
 * user, a role change or a deleted user takes effect immediately instead of
 * waiting for the token to expire.
 *
 * Sets req.user (see AuthUser above).
 */
export async function requireAuth(req, _res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return next(ApiError.unauthorized('Missing or invalid Authorization header'));
  }

  const token = header.slice('Bearer '.length).trim();

  let payload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET);
  } catch {
    // Do not leak why the token failed (expired vs malformed vs wrong signature).
    return next(ApiError.unauthorized('Invalid or expired token'));
  }

  const user = await authRepository.findAuthContextById(payload.sub);

  if (!user || !user.isActive) {
    return next(ApiError.unauthorized('Invalid or expired token'));
  }

  const { isActive, ...safeUser } = user;
  req.user = safeUser;

  return next();
}
