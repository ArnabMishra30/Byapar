import * as customerPaymentService from './customer-payment.service.js';
import { sendSuccess, sendPaginated } from '../../utils/response.js';

// HTTP only. No business rules, no Prisma.

export async function list(req, res) {
  const { payments, pagination } = await customerPaymentService.list(req.user, req.validated.query);
  return sendPaginated(res, payments, pagination);
}

export async function get(req, res) {
  const payment = await customerPaymentService.getById(req.user, req.validated.params.id);
  return sendSuccess(res, { payment });
}

export async function create(req, res) {
  const payment = await customerPaymentService.createDraft(req.user, req.body);
  return sendSuccess(res, { payment }, 201, 'Customer payment draft created successfully');
}

export async function update(req, res) {
  const payment = await customerPaymentService.updateDraft(
    req.user,
    req.validated.params.id,
    req.body,
  );
  return sendSuccess(res, { payment }, 200, 'Customer payment draft updated successfully');
}

export async function post(req, res) {
  const payment = await customerPaymentService.post(req.user, req.validated.params.id);
  return sendSuccess(res, { payment }, 200, 'Customer payment posted successfully');
}

export async function cancel(req, res) {
  const payment = await customerPaymentService.cancel(req.user, req.validated.params.id);
  return sendSuccess(res, { payment }, 200, 'Customer payment cancelled successfully');
}
