import * as supplierPayableService from './supplier-payable.service.js';
import { sendSuccess, sendPaginated } from '../../utils/response.js';

// HTTP only. No business rules, no Prisma.

export async function listPayables(req, res) {
  const { payables, pagination } = await supplierPayableService.listPayables(
    req.user,
    req.validated.query,
  );
  return sendPaginated(res, payables, pagination);
}

export async function getPayable(req, res) {
  const payable = await supplierPayableService.getPayableById(req.user, req.validated.params.id);
  return sendSuccess(res, { payable });
}

export async function supplierLedger(req, res) {
  const ledger = await supplierPayableService.getSupplierLedger(
    req.user,
    req.validated.params.supplierId,
    req.validated.query ?? {},
  );
  return sendSuccess(res, { ledger });
}

export async function supplierOutstanding(req, res) {
  const outstanding = await supplierPayableService.getSupplierOutstanding(
    req.user,
    req.validated.params.supplierId,
  );
  return sendSuccess(res, { outstanding });
}

export async function supplierOutstandingPayables(req, res) {
  const payables = await supplierPayableService.listOutstandingPayables(
    req.user,
    req.validated.params.supplierId,
  );
  return sendSuccess(res, { payables });
}
