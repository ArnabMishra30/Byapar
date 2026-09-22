import * as taxService from './tax.service.js';
import { sendSuccess, sendPaginated } from '../../utils/response.js';

export async function list(req, res) {
  const { taxes, pagination } = await taxService.list(req.user, req.validated.query);
  return sendPaginated(res, taxes, pagination);
}

export async function get(req, res) {
  const tax = await taxService.getById(req.user, req.validated.params.id);
  return sendSuccess(res, { tax });
}

export async function create(req, res) {
  const tax = await taxService.create(req.user, req.body);
  return sendSuccess(res, { tax }, 201, 'Tax created successfully');
}

export async function update(req, res) {
  const tax = await taxService.update(req.user, req.validated.params.id, req.body);
  return sendSuccess(res, { tax }, 200, 'Tax updated successfully');
}

export async function updateStatus(req, res) {
  const tax = await taxService.updateStatus(req.user, req.validated.params.id, req.body.isActive);
  return sendSuccess(res, { tax }, 200, 'Tax status updated successfully');
}
