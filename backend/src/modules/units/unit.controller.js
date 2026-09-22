import * as unitService from './unit.service.js';
import { sendSuccess, sendPaginated } from '../../utils/response.js';

export async function list(req, res) {
  const { units, pagination } = await unitService.list(req.user, req.validated.query);
  return sendPaginated(res, units, pagination);
}

export async function get(req, res) {
  const unit = await unitService.getById(req.user, req.validated.params.id);
  return sendSuccess(res, { unit });
}

export async function create(req, res) {
  const unit = await unitService.create(req.user, req.body);
  return sendSuccess(res, { unit }, 201, 'Unit created successfully');
}

export async function update(req, res) {
  const unit = await unitService.update(req.user, req.validated.params.id, req.body);
  return sendSuccess(res, { unit }, 200, 'Unit updated successfully');
}

export async function updateStatus(req, res) {
  const unit = await unitService.updateStatus(req.user, req.validated.params.id, req.body.isActive);
  return sendSuccess(res, { unit }, 200, 'Unit status updated successfully');
}
