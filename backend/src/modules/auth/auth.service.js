import { verify as verifyPassword, hash as hashPasswordRaw } from '@node-rs/argon2';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/api-error.js';
import * as authRepository from './auth.repository.js';

// Business rules for authentication. No Prisma calls here - see auth.repository.js.

// Argon2id settings (OWASP baseline). Every password in the system is hashed
// through hashPassword() so the parameters are always the same.
const ARGON_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(plainPassword) {
  return hashPasswordRaw(plainPassword, ARGON_OPTIONS);
}

export function verifyPasswordHash(passwordHash, plainPassword) {
  return verifyPassword(passwordHash, plainPassword, ARGON_OPTIONS);
}

/** Only these fields ever leave the API. passwordHash is never included. */
export function toPublicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    companyId: user.companyId,
  };
}

function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, companyId: user.companyId },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN },
  );
}

/**
 * Verifies credentials and returns a token plus safe user data.
 * The same error is used for "unknown email", "wrong password" and "deactivated"
 * so the API does not reveal which emails exist.
 */
export async function login({ email, password }) {
  const user = await authRepository.findUserByEmail(email);

  if (!user || !user.isActive) {
    throw ApiError.unauthorized('Invalid credentials');
  }

  const passwordMatches = await verifyPasswordHash(user.passwordHash, password);

  if (!passwordMatches) {
    throw ApiError.unauthorized('Invalid credentials');
  }

  await authRepository.updateLastLogin(user.id);

  return {
    token: signToken(user),
    user: toPublicUser(user),
  };
}
