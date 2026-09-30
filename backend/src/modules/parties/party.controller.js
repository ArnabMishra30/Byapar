import * as partyService from './party.service.js';
import { sendSuccess, sendPaginated } from '../../utils/response.js';

export async function list(req, res) {
  const { parties, pagination } = await partyService.list(req.user, req.validated.query);
  return sendPaginated(res, parties, pagination);
}

export async function summary(req, res) {
  const counts = await partyService.summary(req.user);
  return sendSuccess(res, { counts });
}

export async function possibleMatches(req, res) {
  const matches = await partyService.possibleMatches(req.user, req.validated.query);
  return sendSuccess(res, { matches });
}

export async function get(req, res) {
  const party = await partyService.getById(req.user, req.validated.params.id);
  return sendSuccess(res, { party });
}

export async function create(req, res) {
  const party = await partyService.create(req.user, req.validated.body);
  return sendSuccess(res, { party }, 201, 'Party created successfully');
}

export async function update(req, res) {
  const party = await partyService.update(req.user, req.validated.params.id, req.validated.body);
  return sendSuccess(res, { party }, 200, 'Party updated successfully');
}

export async function updateStatus(req, res) {
  const party = await partyService.setStatus(
    req.user,
    req.validated.params.id,
    req.validated.body.isActive,
  );
  return sendSuccess(res, { party }, 200, 'Party status updated successfully');
}

export async function addRelationship(req, res) {
  const { role, terms } = req.validated.body;
  const party = await partyService.addRelationship(req.user, req.validated.params.id, role, terms);
  return sendSuccess(res, { party }, 200, 'Relationship added');
}

export async function link(req, res) {
  const party = await partyService.link(req.user, req.validated.params.id, req.validated.body);
  return sendSuccess(res, { party }, 200, 'Record linked to party');
}

export async function customerLedger(req, res) {
  const ledger = await partyService.customerLedger(
    req.user,
    req.validated.params.id,
    req.validated.query,
  );
  return sendSuccess(res, { ledger });
}

export async function supplierLedger(req, res) {
  const ledger = await partyService.supplierLedger(
    req.user,
    req.validated.params.id,
    req.validated.query,
  );
  return sendSuccess(res, { ledger });
}

export async function statement(req, res) {
  const result = await partyService.statement(req.user, req.validated.params.id, req.validated.query);
  return sendSuccess(res, result);
}
