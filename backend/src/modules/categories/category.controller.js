import * as categoryService from './category.service.js';
import { sendSuccess, sendPaginated } from '../../utils/response.js';

export async function list(req, res) {
  const { categories, pagination } = await categoryService.list(req.user, req.validated.query);
  return sendPaginated(res, categories, pagination);
}

export async function get(req, res) {
  const category = await categoryService.getById(req.user, req.validated.params.id);
  return sendSuccess(res, { category });
}

export async function create(req, res) {
  const category = await categoryService.create(req.user, req.body);
  return sendSuccess(res, { category }, 201, 'Category created successfully');
}

export async function update(req, res) {
  const category = await categoryService.update(req.user, req.validated.params.id, req.body);
  return sendSuccess(res, { category }, 200, 'Category updated successfully');
}

export async function updateStatus(req, res) {
  const category = await categoryService.updateStatus(
    req.user,
    req.validated.params.id,
    req.body.isActive,
  );
  return sendSuccess(res, { category }, 200, 'Category status updated successfully');
}
