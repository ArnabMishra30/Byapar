import * as purchaseService from './purchase.service.js';
import { sendSuccess, sendPaginated } from '../../utils/response.js';

// HTTP only. No business rules, no Prisma.

export async function list(req, res) {
  const { purchases, pagination } = await purchaseService.list(req.user, req.validated.query);
  return sendPaginated(res, purchases, pagination);
}

export async function get(req, res) {
  const purchase = await purchaseService.getById(req.user, req.validated.params.id);
  return sendSuccess(res, { purchase });
}

export async function create(req, res) {
  const purchase = await purchaseService.createDraft(req.user, req.body);
  return sendSuccess(res, { purchase }, 201, 'Purchase draft created successfully');
}

export async function update(req, res) {
  const purchase = await purchaseService.updateDraft(req.user, req.validated.params.id, req.body);
  return sendSuccess(res, { purchase }, 200, 'Purchase draft updated successfully');
}

export async function post(req, res) {
  const purchase = await purchaseService.post(req.user, req.validated.params.id);
  return sendSuccess(res, { purchase }, 200, 'Purchase posted successfully');
}

export async function cancel(req, res) {
  const purchase = await purchaseService.cancel(req.user, req.validated.params.id);
  return sendSuccess(res, { purchase }, 200, 'Purchase cancelled successfully');
}
