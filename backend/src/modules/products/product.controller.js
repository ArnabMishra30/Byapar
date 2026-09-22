import * as productService from './product.service.js';
import { sendSuccess, sendPaginated } from '../../utils/response.js';

export async function list(req, res) {
  const { products, pagination } = await productService.list(req.user, req.validated.query);
  return sendPaginated(res, products, pagination);
}

export async function get(req, res) {
  const product = await productService.getById(req.user, req.validated.params.id);
  return sendSuccess(res, { product });
}

export async function create(req, res) {
  const product = await productService.create(req.user, req.body);
  return sendSuccess(res, { product }, 201, 'Product created successfully');
}

export async function update(req, res) {
  const product = await productService.update(req.user, req.validated.params.id, req.body);
  return sendSuccess(res, { product }, 200, 'Product updated successfully');
}

export async function updateStatus(req, res) {
  const product = await productService.updateStatus(
    req.user,
    req.validated.params.id,
    req.body.isActive,
  );
  return sendSuccess(res, { product }, 200, 'Product status updated successfully');
}
