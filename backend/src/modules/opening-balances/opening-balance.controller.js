import * as openingBalanceService from './opening-balance.service.js';
import { sendSuccess } from '../../utils/response.js';

// HTTP only. No business rules, no Prisma.

export async function getStatus(req, res) {
  const status = await openingBalanceService.getStatus(req.user);
  return sendSuccess(res, { openingBalances: status });
}

export async function getDetails(req, res) {
  const details = await openingBalanceService.getDetails(req.user);
  return sendSuccess(res, { openingBalances: details });
}

export async function initialize(req, res) {
  const result = await openingBalanceService.initialize(req.user, req.body);
  return sendSuccess(res, { openingBalances: result }, 201, 'Opening balances established successfully');
}
