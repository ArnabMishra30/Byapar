import { isProduction } from '../config/env.js';

// Session cookies.
//
// Both are httpOnly, so no script on the page - including an injected one - can
// read them. The browser attaches them itself.
//
// SameSite=Strict: the browser never sends them on a request started by another
// site, which is what makes them safe against CSRF without a separate token.
// That only works because each frontend proxies /api/v1 on its OWN origin, so
// the API is same-site from the browser's point of view (see next.config.mjs in
// both frontends).
//
// Secure in production only: local development runs over plain http.

export const ACCESS_COOKIE = 'byapar_at';
export const REFRESH_COOKIE = 'byapar_rt';

/** Sent with every API call. */
const ACCESS_PATH = '/api/v1';
/** Sent ONLY to /auth/refresh and /auth/logout, never to ordinary routes. */
const REFRESH_PATH = '/api/v1/auth';

function baseOptions(path) {
  return { httpOnly: true, secure: isProduction, sameSite: 'strict', path };
}

export function setSessionCookies(res, { accessToken, accessExpiresAt, refreshToken, refreshExpiresAt }) {
  res.cookie(ACCESS_COOKIE, accessToken, { ...baseOptions(ACCESS_PATH), expires: accessExpiresAt });
  if (refreshToken) {
    res.cookie(REFRESH_COOKIE, refreshToken, { ...baseOptions(REFRESH_PATH), expires: refreshExpiresAt });
  }
}

export function clearSessionCookies(res) {
  res.clearCookie(ACCESS_COOKIE, baseOptions(ACCESS_PATH));
  res.clearCookie(REFRESH_COOKIE, baseOptions(REFRESH_PATH));
}

/**
 * Reads one cookie from the request. Express 5 has no cookie parser built in,
 * and two cookies do not justify a dependency.
 */
export function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;

    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }

  return null;
}
