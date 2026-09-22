import * as customerReceivableService from './customer-receivable.service.js';
import * as customerPaymentService from '../customer-payments/customer-payment.service.js';
import { sendSuccess, sendPaginated } from '../../utils/response.js';

// HTTP only. No business rules, no Prisma.

export async function listReceivables(req, res) {
  const { receivables, pagination } = await customerReceivableService.listReceivables(
    req.user,
    req.validated.query,
  );
  return sendPaginated(res, receivables, pagination);
}

export async function getReceivable(req, res) {
  const receivable = await customerReceivableService.getReceivableById(
    req.user,
    req.validated.params.id,
  );
  return sendSuccess(res, { receivable });
}

export async function customerLedger(req, res) {
  const ledger = await customerReceivableService.getCustomerLedger(
    req.user,
    req.validated.params.id,
    req.validated.query ?? {},
  );
  return sendSuccess(res, { ledger });
}

export async function customerOutstanding(req, res) {
  const outstanding = await customerReceivableService.getCustomerOutstanding(
    req.user,
    req.validated.params.id,
  );
  return sendSuccess(res, { outstanding });
}

export async function customerReceivables(req, res) {
  const receivables = await customerReceivableService.listOutstandingReceivables(
    req.user,
    req.validated.params.id,
  );
  return sendSuccess(res, { receivables });
}

export async function customerPayments(req, res) {
  const { payments, pagination } = await customerPaymentService.listByCustomer(
    req.user,
    req.validated.params.id,
    req.validated.query,
  );
  return sendPaginated(res, payments, pagination);
}
