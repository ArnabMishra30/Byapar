import * as dashboardService from './dashboard.service.js';
import * as businessReportService from './business-report.service.js';
import * as creditService from './credit.service.js';
import { sendSuccess, sendPaginated } from '../../utils/response.js';

// HTTP only. No business rules, no Prisma.
//
// Every handler here is a GET. This module reads; it never writes.

// --- dashboard -------------------------------------------------------------

export async function getDashboard(req, res) {
  const dashboard = await dashboardService.getDashboard(req.user, req.validated.query);
  return sendSuccess(res, { dashboard });
}

// --- reports ---------------------------------------------------------------

export async function getSalesReport(req, res) {
  const report = await businessReportService.getSalesReport(req.user, req.validated.query);
  return sendSuccess(res, { report });
}

export async function getPurchasesReport(req, res) {
  const report = await businessReportService.getPurchasesReport(req.user, req.validated.query);
  return sendSuccess(res, { report });
}

export async function getCustomerOutstandingReport(req, res) {
  const report = await businessReportService.getCustomerOutstandingReport(
    req.user,
    req.validated.query,
  );
  return sendSuccess(res, { report });
}

export async function getSupplierOutstandingReport(req, res) {
  const report = await businessReportService.getSupplierOutstandingReport(
    req.user,
    req.validated.query,
  );
  return sendSuccess(res, { report });
}

export async function getCustomerLedgerReport(req, res) {
  const ledger = await businessReportService.getCustomerLedgerReport(
    req.user,
    req.validated.params.id,
    req.validated.query,
  );
  return sendSuccess(res, { ledger });
}

export async function getSupplierLedgerReport(req, res) {
  const ledger = await businessReportService.getSupplierLedgerReport(
    req.user,
    req.validated.params.id,
    req.validated.query,
  );
  return sendSuccess(res, { ledger });
}

export async function getPaymentsReceivedReport(req, res) {
  const report = await businessReportService.getPaymentsReceivedReport(
    req.user,
    req.validated.query,
  );
  return sendSuccess(res, { report });
}

export async function getSupplierPaymentsReport(req, res) {
  const report = await businessReportService.getSupplierPaymentsReport(
    req.user,
    req.validated.query,
  );
  return sendSuccess(res, { report });
}

export async function getExpensesReport(req, res) {
  const report = await businessReportService.getExpensesReport(req.user, req.validated.query);
  return sendSuccess(res, { report });
}

export async function getInventoryValuationReport(req, res) {
  const report = await businessReportService.getInventoryValuationReport(
    req.user,
    req.validated.query,
  );
  return sendSuccess(res, { report });
}

export async function getProfitAndLossReport(req, res) {
  const report = await businessReportService.getProfitAndLossReport(req.user, req.validated.query);
  return sendSuccess(res, { report });
}

export async function getGeneralLedgerReport(req, res) {
  const { entries, pagination } = await businessReportService.getGeneralLedgerReport(
    req.user,
    req.validated.query,
  );
  return sendPaginated(res, entries, pagination);
}

export async function getCashBankReport(req, res) {
  const report = await businessReportService.getCashBankReport(req.user, req.validated.query);
  return sendSuccess(res, { report });
}

// --- credit book -----------------------------------------------------------

export async function getCreditSummary(req, res) {
  const credit = await creditService.getCreditSummary(req.user, req.validated.query);
  return sendSuccess(res, { credit });
}

export async function getReceivables(req, res) {
  const receivables = await creditService.getReceivables(req.user, req.validated.query);
  return sendSuccess(res, { receivables });
}

export async function getPayables(req, res) {
  const payables = await creditService.getPayables(req.user, req.validated.query);
  return sendSuccess(res, { payables });
}

export async function getCustomerCredit(req, res) {
  const credit = await creditService.getCustomerCredit(
    req.user,
    req.validated.params.id,
    req.validated.query,
  );
  return sendSuccess(res, { credit });
}

export async function getSupplierCredit(req, res) {
  const credit = await creditService.getSupplierCredit(
    req.user,
    req.validated.params.id,
    req.validated.query,
  );
  return sendSuccess(res, { credit });
}
