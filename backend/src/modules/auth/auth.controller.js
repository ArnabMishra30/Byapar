import * as authService from './auth.service.js';
import { sendSuccess } from '../../utils/response.js';

// No try/catch needed: Express 5 forwards async errors to the error handler.

export async function login(req, res) {
  const result = await authService.login(req.body);
  return sendSuccess(res, result);
}

export async function me(req, res) {
  // requireAuth already loaded the user and stripped unsafe fields.
  return sendSuccess(res, { user: req.user });
}
