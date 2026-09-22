import { Router } from 'express';
import * as companySettingsController from './company-settings.controller.js';
import { updateCompanySettingsSchema } from './company-settings.validation.js';
import { validate } from '../../middlewares/validate.js';
import { requireAuth } from '../../middlewares/require-auth.js';
import { requireRole } from '../../middlewares/require-role.js';

export const companySettingsRoutes = Router();

// There is no POST: settings are created automatically with the company.
// Read: any authenticated user. Write: ADMIN only.
companySettingsRoutes.use(requireAuth);

companySettingsRoutes.get('/', companySettingsController.get);

companySettingsRoutes.patch(
  '/',
  requireRole('ADMIN'),
  validate({ body: updateCompanySettingsSchema }),
  companySettingsController.update,
);
