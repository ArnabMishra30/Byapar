import * as accountService from './account.service.js';
import * as journalService from './journal.service.js';
import * as reportService from './report.service.js';
import { sendSuccess, sendPaginated } from '../../utils/response.js';
import { toSkipTake } from '../../utils/pagination.js';

// HTTP only. No business rules, no Prisma.

// --- chart of accounts -----------------------------------------------------

export async function listAccounts(req, res) {
  const { accounts, pagination } = await accountService.list(req.user, req.validated.query);
  return sendPaginated(res, accounts, pagination);
}

export async function getAccount(req, res) {
  const account = await accountService.getById(req.user, req.validated.params.id);
  return sendSuccess(res, { account });
}

export async function createAccount(req, res) {
  const account = await accountService.create(req.user, req.body);
  return sendSuccess(res, { account }, 201, 'Account created successfully');
}

export async function updateAccount(req, res) {
  const account = await accountService.update(req.user, req.validated.params.id, req.body);
  return sendSuccess(res, { account }, 200, 'Account updated successfully');
}

export async function deleteAccount(req, res) {
  const result = await accountService.remove(req.user, req.validated.params.id);
  return sendSuccess(res, result, 200, 'Account deleted successfully');
}

export async function getAccountLedger(req, res) {
  const { page, limit, ...filters } = req.validated.query;
  const { skip, take } = toSkipTake({ page, limit });

  const ledger = await accountService.getLedger(req.user, req.validated.params.id, {
    ...filters,
    skip,
    take,
  });

  return sendSuccess(res, { ledger });
}

// --- journal entries -------------------------------------------------------

export async function listJournalEntries(req, res) {
  const { journalEntries, pagination } = await journalService.list(req.user, req.validated.query);
  return sendPaginated(res, journalEntries, pagination);
}

export async function getJournalEntry(req, res) {
  const journalEntry = await journalService.getById(req.user, req.validated.params.id);
  return sendSuccess(res, { journalEntry });
}

/** Source traceability: "which journal explains this document?" */
export async function getJournalEntryBySource(req, res) {
  const { sourceType, sourceId } = req.validated.params;
  const journalEntry = await journalService.getBySource(req.user, sourceType, sourceId);
  return sendSuccess(res, { journalEntry });
}

export async function reverseJournalEntry(req, res) {
  const journalEntry = await journalService.reverse(req.user, req.validated.params.id, req.body);
  return sendSuccess(res, { journalEntry }, 201, 'Journal entry reversed successfully');
}

// --- general ledger --------------------------------------------------------

export async function listGeneralLedger(req, res) {
  const { entries, pagination } = await journalService.listGeneralLedger(
    req.user,
    req.validated.query,
  );
  return sendPaginated(res, entries, pagination);
}

export async function getGeneralLedgerSummary(req, res) {
  const summary = await reportService.getGeneralLedgerSummary(req.user, req.validated.query);
  return sendSuccess(res, { summary });
}

// --- financial statements --------------------------------------------------

export async function getTrialBalance(req, res) {
  const trialBalance = await reportService.getTrialBalance(req.user, req.validated.query);
  return sendSuccess(res, { trialBalance });
}

export async function getProfitAndLoss(req, res) {
  const { from, to } = req.validated.query;
  const profitAndLoss = await reportService.getProfitAndLoss(req.user, {
    dateFrom: from,
    dateTo: to,
  });
  return sendSuccess(res, { profitAndLoss });
}

export async function getBalanceSheet(req, res) {
  const balanceSheet = await reportService.getBalanceSheet(req.user, req.validated.query);
  return sendSuccess(res, { balanceSheet });
}
