import * as warehouseService from './warehouse.service.js';
import { sendSuccess, sendPaginated } from '../../utils/response.js';

export async function list(req, res) {
  const { warehouses, pagination } = await warehouseService.list(req.user, req.validated.query);
  return sendPaginated(res, warehouses, pagination);
}

export async function get(req, res) {
  const warehouse = await warehouseService.getById(req.user, req.validated.params.id);
  return sendSuccess(res, { warehouse });
}

export async function create(req, res) {
  const warehouse = await warehouseService.create(req.user, req.body);
  return sendSuccess(res, { warehouse }, 201, 'Warehouse created successfully');
}

export async function update(req, res) {
  const warehouse = await warehouseService.update(req.user, req.validated.params.id, req.body);
  return sendSuccess(res, { warehouse }, 200, 'Warehouse updated successfully');
}

export async function updateStatus(req, res) {
  const warehouse = await warehouseService.updateStatus(
    req.user,
    req.validated.params.id,
    req.body.isActive,
  );
  return sendSuccess(res, { warehouse }, 200, 'Warehouse status updated successfully');
}
