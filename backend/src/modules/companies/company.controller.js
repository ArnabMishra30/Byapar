import * as companyService from './company.service.js';
import { sendSuccess } from '../../utils/response.js';

// HTTP concerns only. No business rules, no Prisma.

export async function getCompany(req, res) {
  const company = await companyService.getCompanyById(req.user, req.validated.params.id);
  return sendSuccess(res, { company });
}

export async function getCurrentCompany(req, res) {
  const company = await companyService.getCompanyById(req.user, req.user.companyId);
  return sendSuccess(res, { company });
}

export async function createCompany(req, res) {
  const { company, admin } = await companyService.createCompany(req.user, req.body);
  return sendSuccess(res, { company, admin }, 201, 'Company created successfully');
}

export async function updateCompany(req, res) {
  const company = await companyService.updateCompany(req.user, req.validated.params.id, req.body);
  return sendSuccess(res, { company }, 200, 'Company updated successfully');
}
