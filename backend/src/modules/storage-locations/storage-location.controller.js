import * as locationService from './storage-location.service.js';
import { sendSuccess, sendPaginated } from '../../utils/response.js';

export async function list(req, res) {
  const { locations, pagination } = await locationService.list(req.user, req.validated.query);
  return sendPaginated(res, locations, pagination);
}

export async function get(req, res) {
  const location = await locationService.getById(req.user, req.validated.params.id);
  return sendSuccess(res, { location });
}

export async function create(req, res) {
  const location = await locationService.create(req.user, req.validated.body);
  return sendSuccess(res, { location }, 201, 'Location created successfully');
}

export async function update(req, res) {
  const location = await locationService.update(req.user, req.validated.params.id, req.validated.body);
  return sendSuccess(res, { location }, 200, 'Location updated successfully');
}

export async function updateStatus(req, res) {
  const location = await locationService.updateStatus(
    req.user,
    req.validated.params.id,
    req.validated.body.isActive,
  );
  return sendSuccess(res, { location }, 200, 'Location status updated successfully');
}

export async function addStarter(req, res) {
  const { locations } = await locationService.addStarterLocations(req.user, req.validated.body.warehouseId);
  return sendSuccess(res, { locations }, 201, 'Starter locations added');
}
