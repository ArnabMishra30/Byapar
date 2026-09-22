import * as supplierService from './supplier.service.js';
import { sendSuccess, sendPaginated } from '../../utils/response.js';

export async function list(req, res) {
  const { suppliers, pagination } = await supplierService.list(req.user, req.validated.query);
  return sendPaginated(res, suppliers, pagination);
}

export async function get(req, res) {
  const supplier = await supplierService.getById(req.user, req.validated.params.id);
  return sendSuccess(res, { supplier });
}

export async function create(req, res) {
  const supplier = await supplierService.create(req.user, req.body);
  return sendSuccess(res, { supplier }, 201, 'Supplier created successfully');
}

export async function update(req, res) {
  const supplier = await supplierService.update(req.user, req.validated.params.id, req.body);
  return sendSuccess(res, { supplier }, 200, 'Supplier updated successfully');
}

export async function updateStatus(req, res) {
  const supplier = await supplierService.updateStatus(
    req.user,
    req.validated.params.id,
    req.body.isActive,
  );
  return sendSuccess(res, { supplier }, 200, 'Supplier status updated successfully');
}
