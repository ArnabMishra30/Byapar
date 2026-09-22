import { Router } from 'express';
import * as companyController from './company.controller.js';
import {
  companyIdParamSchema,
  createCompanySchema,
  updateCompanySchema,
} from './company.validation.js';
import { validate } from '../../middlewares/validate.js';
import { requireAuth } from '../../middlewares/require-auth.js';
import { requireRole, requireCompanyAccess } from '../../middlewares/require-role.js';

export const companyRoutes = Router();

companyRoutes.use(requireAuth);

// Any authenticated user can read their own company.
companyRoutes.get('/me', companyController.getCurrentCompany);

// Everything below is ADMIN only.
companyRoutes.post(
  '/',
  requireRole('ADMIN'),
  validate({ body: createCompanySchema }),
  companyController.createCompany,
);

// requireCompanyAccess('id') blocks other companies before the service runs.
// The service checks again, because services are also called from tests and jobs.
companyRoutes.get(
  '/:id',
  requireRole('ADMIN'),
  validate({ params: companyIdParamSchema }),
  requireCompanyAccess('id'),
  companyController.getCompany,
);

companyRoutes.patch(
  '/:id',
  requireRole('ADMIN'),
  validate({ params: companyIdParamSchema, body: updateCompanySchema }),
  requireCompanyAccess('id'),
  companyController.updateCompany,
);
