import * as companySettingsService from './company-settings.service.js';
import { sendSuccess } from '../../utils/response.js';

export async function get(req, res) {
  const settings = await companySettingsService.getForCompany(req.user);
  return sendSuccess(res, { settings });
}

export async function update(req, res) {
  const settings = await companySettingsService.update(req.user, req.body);
  return sendSuccess(res, { settings }, 200, 'Company settings updated successfully');
}
