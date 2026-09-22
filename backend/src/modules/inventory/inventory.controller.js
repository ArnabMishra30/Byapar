import * as inventoryService from './inventory.service.js';
import { sendSuccess, sendPaginated } from '../../utils/response.js';

// HTTP only. No business rules, no Prisma.

export async function listBalances(req, res) {
  const { balances, pagination } = await inventoryService.listBalances(req.user, req.validated.query);
  return sendPaginated(res, balances, pagination);
}

export async function getBalance(req, res) {
  const { productId, warehouseId } = req.validated.params;
  const balance = await inventoryService.getBalance(req.user, productId, warehouseId);
  return sendSuccess(res, { balance });
}

export async function listMovements(req, res) {
  const { movements, pagination } = await inventoryService.listMovements(
    req.user,
    req.validated.query,
  );
  return sendPaginated(res, movements, pagination);
}

export async function getMovement(req, res) {
  const movement = await inventoryService.getMovement(req.user, req.validated.params.id);
  return sendSuccess(res, { movement });
}

export async function createOpeningStock(req, res) {
  const movement = await inventoryService.createOpeningStock(req.user, req.body);
  return sendSuccess(res, { movement }, 201, 'Opening stock recorded successfully');
}

export async function createAdjustment(req, res) {
  const movement = await inventoryService.createAdjustment(req.user, req.body);
  return sendSuccess(res, { movement }, 201, 'Stock adjustment recorded successfully');
}
