import * as billService from './bill.service.js';
import { sendSuccess, sendPaginated } from '../../utils/response.js';

// HTTP only. No business rules, no Prisma.

export async function upload(req, res) {
  // req.file comes from multer; req.body carries the direction. The company is
  // taken from req.user inside the service and is not a field on this request.
  const bill = await billService.upload(req.user, req.file, req.body);
  return sendSuccess(res, { bill }, 201, 'Bill uploaded');
}

export async function list(req, res) {
  const { bills, pagination } = await billService.list(req.user, req.validated.query);
  return sendPaginated(res, bills, pagination);
}

export async function summary(req, res) {
  const summaryData = await billService.summary(req.user);
  return sendSuccess(res, summaryData);
}

export async function get(req, res) {
  const bill = await billService.getById(req.user, req.validated.params.id);
  return sendSuccess(res, { bill });
}

/**
 * The uploaded image or PDF itself.
 *
 * Served through the API so it needs a token and the right company. The filename
 * is quoted and stripped of anything but safe characters upstream, so it cannot
 * inject a header.
 */
export async function file(req, res) {
  const { buffer, mimeType, filename } = await billService.getFile(
    req.user,
    req.validated.params.id,
  );

  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  // Nothing about a bill should be cached by a shared proxy.
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  return res.send(buffer);
}

export async function retry(req, res) {
  const bill = await billService.retryExtraction(req.user, req.validated.params.id);
  return sendSuccess(res, { bill }, 200, 'Bill re-read');
}

export async function saveReview(req, res) {
  const bill = await billService.saveReview(
    req.user,
    req.validated.params.id,
    req.body.reviewedData,
  );
  return sendSuccess(res, { bill }, 200, 'Changes saved');
}

export async function suggestions(req, res) {
  const matches = await billService.suggestions(req.user, req.validated.params.id);
  return sendSuccess(res, matches);
}

export async function confirm(req, res) {
  const result = await billService.confirm(req.user, req.validated.params.id, req.body);
  return sendSuccess(res, result, 201, 'Bill recorded successfully');
}

export async function cancel(req, res) {
  const bill = await billService.cancel(req.user, req.validated.params.id, req.body.reason);
  return sendSuccess(res, { bill }, 200, 'Bill cancelled');
}
