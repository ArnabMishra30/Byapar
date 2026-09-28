import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { ApiError } from '../utils/api-error.js';
import * as authRepository from '../modules/auth/auth.repository.js';
import { ACCESS_COOKIE, readCookie } from '../utils/cookies.js';

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
 * Finds the access token: the httpOnly session cookie the browser sends, or an
 * "Authorization: Bearer <token>" header from a non-browser client (scripts,
 * tests). A Bearer header cannot be forged by another site, so accepting it
 * does not reopen CSRF.
 */
function readAccessToken(req) {
  const fromCookie = readCookie(req, ACCESS_COOKIE);
  if (fromCookie) return fromCookie;

  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim() || null;
  }
  return null;
}

/**
 * Reads the access token (see readAccessToken), verifies it, and loads the user.
 *
 * The token is only used to identify WHICH user is calling. Role, company and
 * active status are re-read from the database on every request, so a deactivated
 * user, a role change or a deleted user takes effect immediately instead of
 * waiting for the token to expire.
 *
 * Sets req.user (see AuthUser above).
 */
export async function requireAuth(req, _res, next) {
  const token = readAccessToken(req);

  if (!token) {
    return next(ApiError.unauthorized('Not signed in'));
  }

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
