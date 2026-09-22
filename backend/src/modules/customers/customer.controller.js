import * as customerService from './customer.service.js';
import { sendSuccess, sendPaginated } from '../../utils/response.js';

export async function list(req, res) {
  const { customers, pagination } = await customerService.list(req.user, req.validated.query);
  return sendPaginated(res, customers, pagination);
}

export async function get(req, res) {
  const customer = await customerService.getById(req.user, req.validated.params.id);
  return sendSuccess(res, { customer });
}

export async function create(req, res) {
  const customer = await customerService.create(req.user, req.body);
  return sendSuccess(res, { customer }, 201, 'Customer created successfully');
}

export async function update(req, res) {
  const customer = await customerService.update(req.user, req.validated.params.id, req.body);
  return sendSuccess(res, { customer }, 200, 'Customer updated successfully');
}

export async function updateStatus(req, res) {
  const customer = await customerService.updateStatus(
    req.user,
    req.validated.params.id,
    req.body.isActive,
  );
  return sendSuccess(res, { customer }, 200, 'Customer status updated successfully');
}
