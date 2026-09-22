import * as salesService from './sales.service.js';
import { sendSuccess, sendPaginated } from '../../utils/response.js';

// HTTP only. No business rules, no Prisma.

export async function list(req, res) {
  const { sales, pagination } = await salesService.list(req.user, req.validated.query);
  return sendPaginated(res, sales, pagination);
}

export async function get(req, res) {
  const sale = await salesService.getById(req.user, req.validated.params.id);
  return sendSuccess(res, { sale });
}

export async function create(req, res) {
  const sale = await salesService.createDraft(req.user, req.body);
  return sendSuccess(res, { sale }, 201, 'Sales invoice draft created successfully');
}

export async function update(req, res) {
  const sale = await salesService.updateDraft(req.user, req.validated.params.id, req.body);
  return sendSuccess(res, { sale }, 200, 'Sales invoice draft updated successfully');
}

export async function post(req, res) {
  const sale = await salesService.post(req.user, req.validated.params.id, req.body ?? {});
  return sendSuccess(res, { sale }, 200, 'Sales invoice posted successfully');
}

export async function cancel(req, res) {
  const sale = await salesService.cancel(req.user, req.validated.params.id);
  return sendSuccess(res, { sale }, 200, 'Sales invoice cancelled successfully');
}
