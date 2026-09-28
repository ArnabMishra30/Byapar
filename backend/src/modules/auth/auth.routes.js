import { Router } from 'express';
import * as authController from './auth.controller.js';
import { loginSchema } from './auth.validation.js';
import { validate } from '../../middlewares/validate.js';
import { requireAuth } from '../../middlewares/require-auth.js';

export const authRoutes = Router();

authRoutes.post('/login', validate({ body: loginSchema }), authController.login);
// No requireAuth on these two: they run exactly when the access token has
// expired. The refresh cookie is their credential.
authRoutes.post('/refresh', authController.refresh);
authRoutes.post('/logout', authController.logout);
authRoutes.get('/me', requireAuth, authController.me);
