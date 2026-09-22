import * as expenseService from './expense.service.js';
import { sendSuccess, sendPaginated } from '../../utils/response.js';

// HTTP only. No business rules, no Prisma.

export async function list(req, res) {
  const { expenses, pagination } = await expenseService.list(req.user, req.validated.query);
  return sendPaginated(res, expenses, pagination);
}

/** The category list a form needs. Declared before /:id in the routes. */
export async function listCategories(req, res) {
  const categories = await expenseService.listCategories(req.user);
  return sendSuccess(res, { categories });
}

export async function get(req, res) {
  const expense = await expenseService.getById(req.user, req.validated.params.id);
  return sendSuccess(res, { expense });
}

export async function create(req, res) {
  const expense = await expenseService.createDraft(req.user, req.body);
  return sendSuccess(res, { expense }, 201, 'Expense draft created successfully');
}

export async function update(req, res) {
  const expense = await expenseService.updateDraft(req.user, req.validated.params.id, req.body);
  return sendSuccess(res, { expense }, 200, 'Expense draft updated successfully');
}

export async function post(req, res) {
  const expense = await expenseService.post(req.user, req.validated.params.id);
  return sendSuccess(res, { expense }, 200, 'Expense posted successfully');
}

export async function cancel(req, res) {
  const expense = await expenseService.cancel(req.user, req.validated.params.id);
  return sendSuccess(res, { expense }, 200, 'Expense cancelled successfully');
}

export async function reverse(req, res) {
  const expense = await expenseService.reverse(req.user, req.validated.params.id);
  return sendSuccess(res, { expense }, 200, 'Expense reversed successfully');
}
