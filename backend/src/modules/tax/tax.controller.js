import * as gstProfileService from './gst-profile.service.js';
import * as taxClassificationService from './tax-classification.service.js';
import * as gstReportService from './gst-report.service.js';
import * as gstr1Service from './gstr1.service.js';
import * as gstr3bService from './gstr3b.service.js';
import * as gstReturnReconciliationService from './gst-return-reconciliation.service.js';
import { sendSuccess, sendPaginated } from '../../utils/response.js';

// HTTP only. No business rules, no Prisma.

/** Report filters arrive with short query names; the services take explicit ones. */
function toReportFilters(query) {
  return {
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    stateCode: query.state,
    gstin: query.gstin,
    hsnCode: query.hsn,
    taxRate: query.rate,
    supplyType: query.supplyType,
  };
}

// --- company GST profile ---------------------------------------------------

export async function getProfile(req, res) {
  const profile = await gstProfileService.getProfile(req.user);
  return sendSuccess(res, { gstProfile: profile });
}

export async function updateProfile(req, res) {
  const profile = await gstProfileService.updateProfile(req.user, req.body);
  return sendSuccess(res, { gstProfile: profile }, 200, 'GST profile updated successfully');
}

export async function validateGstin(req, res) {
  return sendSuccess(res, { gstin: gstProfileService.validateGstin(req.body.gstin) });
}

export async function listStates(_req, res) {
  return sendSuccess(res, { states: gstProfileService.getStates() });
}

// --- HSN / SAC -------------------------------------------------------------

export async function listClassifications(req, res) {
  const { classifications, pagination } = await taxClassificationService.list(
    req.user,
    req.validated.query,
  );
  return sendPaginated(res, classifications, pagination);
}

export async function getClassification(req, res) {
  const classification = await taxClassificationService.getById(req.user, req.validated.params.id);
  return sendSuccess(res, { classification });
}

export async function createClassification(req, res) {
  const classification = await taxClassificationService.create(req.user, req.body);
  return sendSuccess(res, { classification }, 201, 'HSN/SAC code created successfully');
}

export async function updateClassification(req, res) {
  const classification = await taxClassificationService.update(
    req.user,
    req.validated.params.id,
    req.body,
  );
  return sendSuccess(res, { classification }, 200, 'HSN/SAC code updated successfully');
}

// --- summaries -------------------------------------------------------------

export async function getSummary(req, res) {
  const summary = await gstReportService.getGstSummary(req.user, toReportFilters(req.validated.query));
  return sendSuccess(res, { gstSummary: summary });
}

export async function getInputTax(req, res) {
  const inputTax = await gstReportService.getInputTax(req.user, toReportFilters(req.validated.query));
  return sendSuccess(res, { inputTax });
}

export async function getOutputTax(req, res) {
  const outputTax = await gstReportService.getOutputTax(
    req.user,
    toReportFilters(req.validated.query),
  );
  return sendSuccess(res, { outputTax });
}

/** The purchase side, line by line. */
export async function getPurchaseLines(req, res) {
  const { page, limit, ...filters } = req.validated.query;
  const result = await gstReportService.listTaxLines(req.user, 'PURCHASE', {
    page,
    limit,
    ...toReportFilters(filters),
  });
  return sendSuccess(res, { gstPurchases: result });
}

/** The sales side, line by line. */
export async function getSalesLines(req, res) {
  const { page, limit, ...filters } = req.validated.query;
  const result = await gstReportService.listTaxLines(req.user, 'SALES_INVOICE', {
    page,
    limit,
    ...toReportFilters(filters),
  });
  return sendSuccess(res, { gstSales: result });
}

/** Any document type, line by line - including the two return types. */
export async function getLinesBySource(req, res) {
  const { page, limit, ...filters } = req.validated.query;
  const result = await gstReportService.listTaxLines(req.user, req.validated.params.source, {
    page,
    limit,
    ...toReportFilters(filters),
  });
  return sendSuccess(res, { gstLines: result });
}

// --- GST return preparation ------------------------------------------------
//
// All three are READ-ONLY. Nothing in this phase writes a document, a journal or
// a tax figure: a return is prepared from what is already posted.

export async function getGstr1(req, res) {
  const { fromDate, toDate } = req.validated.query;
  const gstr1 = await gstr1Service.buildGstr1(req.user, { fromDate, toDate });
  return sendSuccess(res, { gstr1 });
}

export async function getGstr3b(req, res) {
  const { fromDate, toDate } = req.validated.query;
  const gstr3b = await gstr3bService.buildGstr3b(req.user, { fromDate, toDate });
  return sendSuccess(res, { gstr3b });
}

export async function getReturnReconciliation(req, res) {
  const { fromDate, toDate } = req.validated.query;
  const reconciliation = await gstReturnReconciliationService.buildReconciliation(req.user, {
    fromDate,
    toDate,
  });
  return sendSuccess(res, { reconciliation });
}

export async function getHsnSummary(req, res) {
  const summary = await gstReportService.getHsnSummary(
    req.user,
    req.validated.params.source,
    toReportFilters(req.validated.query),
  );
  return sendSuccess(res, { hsnSummary: summary });
}
