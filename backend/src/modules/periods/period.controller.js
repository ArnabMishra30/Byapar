import * as periodService from './period.service.js';
import { sendSuccess, sendPaginated } from '../../utils/response.js';

// HTTP only. No business rules, no Prisma.

export async function list(req, res) {
  const { periods, pagination } = await periodService.list(req.user, req.validated.query);
  return sendPaginated(res, periods, pagination);
}

/** Declared before /:id in the routes, so "check" is never read as an id. */
export async function checkDate(req, res) {
  const check = await periodService.checkDate(req.user, req.validated.query.date);
  return sendSuccess(res, { check });
}

export async function get(req, res) {
  const period = await periodService.getById(req.user, req.validated.params.id);
  return sendSuccess(res, { period });
}

export async function create(req, res) {
  const period = await periodService.create(req.user, req.body);
  return sendSuccess(res, { period }, 201, 'Accounting period created successfully');
}

/** Would this period close? Read-only, so STAFF may ask as well as ADMIN. */
export async function verify(req, res) {
  const result = await periodService.verify(req.user, req.validated.params.id);
  return sendSuccess(res, result);
}

export async function close(req, res) {
  const period = await periodService.close(req.user, req.validated.params.id);
  return sendSuccess(res, { period }, 200, 'Accounting period closed successfully');
}

export async function reopen(req, res) {
  const period = await periodService.reopen(req.user, req.validated.params.id, req.body);
  return sendSuccess(res, { period }, 200, 'Accounting period reopened successfully');
}
