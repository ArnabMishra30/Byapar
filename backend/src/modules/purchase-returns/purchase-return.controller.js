import * as purchaseReturnService from './purchase-return.service.js';
import { sendSuccess, sendPaginated } from '../../utils/response.js';

// HTTP only. No business rules, no Prisma.

export async function list(req, res) {
  const { purchaseReturns, pagination } = await purchaseReturnService.list(
    req.user,
    req.validated.query,
  );
  return sendPaginated(res, purchaseReturns, pagination);
}

export async function get(req, res) {
  const purchaseReturn = await purchaseReturnService.getById(req.user, req.validated.params.id);
  return sendSuccess(res, { purchaseReturn });
}

export async function returnableLines(req, res) {
  const returnable = await purchaseReturnService.getReturnableLines(
    req.user,
    req.validated.params.purchaseId,
  );
  return sendSuccess(res, { returnable });
}

export async function create(req, res) {
  const purchaseReturn = await purchaseReturnService.createDraft(req.user, req.body);
  return sendSuccess(res, { purchaseReturn }, 201, 'Purchase return draft created successfully');
}

export async function update(req, res) {
  const purchaseReturn = await purchaseReturnService.updateDraft(
    req.user,
    req.validated.params.id,
    req.body,
  );
  return sendSuccess(res, { purchaseReturn }, 200, 'Purchase return draft updated successfully');
}

export async function post(req, res) {
  const purchaseReturn = await purchaseReturnService.post(req.user, req.validated.params.id);
  return sendSuccess(res, { purchaseReturn }, 200, 'Purchase return posted successfully');
}

export async function cancel(req, res) {
  const purchaseReturn = await purchaseReturnService.cancel(req.user, req.validated.params.id);
  return sendSuccess(res, { purchaseReturn }, 200, 'Purchase return cancelled successfully');
}
