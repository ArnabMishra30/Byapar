import * as salesReturnService from './sales-return.service.js';
import { sendSuccess, sendPaginated } from '../../utils/response.js';

// HTTP only. No business rules, no Prisma.

export async function list(req, res) {
  const { salesReturns, pagination } = await salesReturnService.list(req.user, req.validated.query);
  return sendPaginated(res, salesReturns, pagination);
}

export async function get(req, res) {
  const salesReturn = await salesReturnService.getById(req.user, req.validated.params.id);
  return sendSuccess(res, { salesReturn });
}

export async function returnableLines(req, res) {
  const returnable = await salesReturnService.getReturnableLines(
    req.user,
    req.validated.params.salesInvoiceId,
  );
  return sendSuccess(res, { returnable });
}

export async function create(req, res) {
  const salesReturn = await salesReturnService.createDraft(req.user, req.body);
  return sendSuccess(res, { salesReturn }, 201, 'Sales return draft created successfully');
}

export async function update(req, res) {
  const salesReturn = await salesReturnService.updateDraft(
    req.user,
    req.validated.params.id,
    req.body,
  );
  return sendSuccess(res, { salesReturn }, 200, 'Sales return draft updated successfully');
}

export async function post(req, res) {
  const salesReturn = await salesReturnService.post(req.user, req.validated.params.id);
  return sendSuccess(res, { salesReturn }, 200, 'Sales return posted successfully');
}

export async function cancel(req, res) {
  const salesReturn = await salesReturnService.cancel(req.user, req.validated.params.id);
  return sendSuccess(res, { salesReturn }, 200, 'Sales return cancelled successfully');
}
