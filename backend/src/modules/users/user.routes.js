import { Router } from 'express';
import * as userController from './user.controller.js';
import {
  listUsersQuerySchema,
  createUserSchema,
  updateUserSchema,
  updateUserStatusSchema,
  userIdParamSchema,
} from './user.validation.js';
import { validate } from '../../middlewares/validate.js';
import { requireAuth } from '../../middlewares/require-auth.js';
import { requireRole } from '../../middlewares/require-role.js';
import { sendSuccess } from '../../utils/response.js';
import { SHOP_PERMISSIONS, SHOP_ROLE_TEMPLATES } from './shop-permissions.js';

export const userRoutes = Router();

// Every user management endpoint is ADMIN only and scoped to the admin's own company.
userRoutes.use(requireAuth, requireRole('ADMIN'));

userRoutes.get('/', validate({ query: listUsersQuerySchema }), userController.listUsers);

// The ready-made roles and every permission, with plain-language labels, for
// the owner's staff screen. Before '/:id' so "roles" is not read as an id.
userRoutes.get('/roles', (_req, res) =>
  sendSuccess(res, {
    permissions: Object.entries(SHOP_PERMISSIONS).map(([key, label]) => ({ key, label })),
    roles: Object.entries(SHOP_ROLE_TEMPLATES).map(([key, role]) => ({ key, ...role })),
  }),
);

userRoutes.get('/:id', validate({ params: userIdParamSchema }), userController.getUser);

userRoutes.post('/', validate({ body: createUserSchema }), userController.createUser);

userRoutes.patch(
  '/:id',
  validate({ params: userIdParamSchema, body: updateUserSchema }),
  userController.updateUser,
);

userRoutes.patch(
  '/:id/status',
  validate({ params: userIdParamSchema, body: updateUserStatusSchema }),
  userController.updateUserStatus,
);
