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

export const userRoutes = Router();

// Every user management endpoint is ADMIN only and scoped to the admin's own company.
userRoutes.use(requireAuth, requireRole('ADMIN'));

userRoutes.get('/', validate({ query: listUsersQuerySchema }), userController.listUsers);

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
