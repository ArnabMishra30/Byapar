import * as userService from './user.service.js';
import { sendSuccess, sendPaginated } from '../../utils/response.js';

// HTTP concerns only: read the request, call the service, send the response.
// No business rules and no Prisma calls here.
// Express 5 forwards async errors to the error handler, so no try/catch is needed.

export async function listUsers(req, res) {
  const { users, pagination } = await userService.listUsers(req.user, req.validated.query);
  return sendPaginated(res, users, pagination);
}

export async function getUser(req, res) {
  const user = await userService.getUserById(req.user, req.validated.params.id);
  return sendSuccess(res, { user });
}

export async function createUser(req, res) {
  const user = await userService.createUser(req.user, req.body);
  return sendSuccess(res, { user }, 201, 'User created successfully');
}

export async function updateUser(req, res) {
  const user = await userService.updateUser(req.user, req.validated.params.id, req.body);
  return sendSuccess(res, { user }, 200, 'User updated successfully');
}

export async function updateUserStatus(req, res) {
  const user = await userService.updateUserStatus(
    req.user,
    req.validated.params.id,
    req.body.isActive,
  );
  return sendSuccess(res, { user }, 200, 'User status updated successfully');
}
