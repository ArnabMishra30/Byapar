import { Router } from 'express';
import * as authController from './auth.controller.js';
import { loginSchema } from './auth.validation.js';
import { validate } from '../../middlewares/validate.js';
import { requireAuth } from '../../middlewares/require-auth.js';

export const authRoutes = Router();

authRoutes.post('/login', validate({ body: loginSchema }), authController.login);
authRoutes.get('/me', requireAuth, authController.me);
