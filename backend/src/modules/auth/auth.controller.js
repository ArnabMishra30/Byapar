import * as authService from './auth.service.js';
import { sendSuccess } from '../../utils/response.js';
import {
  REFRESH_COOKIE,
  clearSessionCookies,
  readCookie,
  setSessionCookies,
} from '../../utils/cookies.js';

// No try/catch needed: Express 5 forwards async errors to the error handler.
//
// The tokens travel ONLY as httpOnly cookies. The response body carries the user
// and nothing a script could steal.

export async function login(req, res) {
  const { session, user } = await authService.login(req.body);
  setSessionCookies(res, session);
  return sendSuccess(res, { user });
}

export async function refresh(req, res) {
  try {
    const { session, user } = await authService.refresh(readCookie(req, REFRESH_COOKIE));
    setSessionCookies(res, session);
    return sendSuccess(res, { user });
  } catch (error) {
    // A dead session: drop the cookies so the browser stops presenting them.
    clearSessionCookies(res);
    throw error;
  }
}

export async function logout(req, res) {
  await authService.logout(readCookie(req, REFRESH_COOKIE));
  clearSessionCookies(res);
  return sendSuccess(res, null, 200, 'Signed out');
}

export async function me(req, res) {
  // requireAuth already loaded the user and stripped unsafe fields.
  return sendSuccess(res, { user: req.user });
}
