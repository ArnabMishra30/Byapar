import * as supplierPaymentService from './supplier-payment.service.js';
import { sendSuccess, sendPaginated } from '../../utils/response.js';

// HTTP only. No business rules, no Prisma.

export async function list(req, res) {
  const { payments, pagination } = await supplierPaymentService.list(req.user, req.validated.query);
  return sendPaginated(res, payments, pagination);
}

export async function get(req, res) {
  const payment = await supplierPaymentService.getById(req.user, req.validated.params.id);
  return sendSuccess(res, { payment });
}

export async function create(req, res) {
  const payment = await supplierPaymentService.createDraft(req.user, req.body);
  return sendSuccess(res, { payment }, 201, 'Supplier payment draft created successfully');
}

export async function update(req, res) {
  const payment = await supplierPaymentService.updateDraft(
    req.user,
    req.validated.params.id,
    req.body,
  );
  return sendSuccess(res, { payment }, 200, 'Supplier payment draft updated successfully');
}

export async function post(req, res) {
  const payment = await supplierPaymentService.post(req.user, req.validated.params.id);
  return sendSuccess(res, { payment }, 200, 'Supplier payment posted successfully');
}

export async function cancel(req, res) {
  const payment = await supplierPaymentService.cancel(req.user, req.validated.params.id);
  return sendSuccess(res, { payment }, 200, 'Supplier payment cancelled successfully');
}
