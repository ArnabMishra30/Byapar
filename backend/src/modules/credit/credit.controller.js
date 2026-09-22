import * as statementService from './statement.service.js';
import * as collectionsService from './collections.service.js';
import { sendSuccess } from '../../utils/response.js';

// HTTP only. No business rules, no Prisma.

export async function customerStatement(req, res) {
  const statement = await statementService.getCustomerStatement(
    req.user,
    req.validated.params.id,
    req.validated.query,
  );
  return sendSuccess(res, { statement });
}

export async function supplierStatement(req, res) {
  const statement = await statementService.getSupplierStatement(
    req.user,
    req.validated.params.id,
    req.validated.query,
  );
  return sendSuccess(res, { statement });
}

export async function customerCredit(req, res) {
  const credit = await collectionsService.getCustomerCreditSummary(
    req.user,
    req.validated.params.id,
    req.validated.query,
  );
  return sendSuccess(res, { credit });
}

export async function collectionSummary(req, res) {
  const collections = await collectionsService.getCollectionSummary(req.user, req.validated.query);
  return sendSuccess(res, { collections });
}

export async function payablesSummary(req, res) {
  const payables = await collectionsService.getPayablesSummary(req.user, req.validated.query);
  return sendSuccess(res, { payables });
}

export async function creditExposure(req, res) {
  const exposure = await collectionsService.getCreditExposure(req.user, req.validated.query);
  return sendSuccess(res, { exposure });
}
