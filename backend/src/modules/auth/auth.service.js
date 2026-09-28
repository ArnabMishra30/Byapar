import { verify as verifyPassword, hash as hashPasswordRaw } from '@node-rs/argon2';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { withTransaction } from '../../config/transaction.js';
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

function signAccessToken(user) {
  const token = jwt.sign(
    { sub: user.id, role: user.role, companyId: user.companyId },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN },
  );
  return { accessToken: token, accessExpiresAt: new Date(jwt.decode(token).exp * 1000) };
}

// --- refresh tokens ---------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long a just-rotated token is still accepted without alarm.
 *
 * Two tabs that refresh at the same moment both send the same token; one wins
 * the rotation and the other arrives a few milliseconds later holding a token
 * that is now revoked. That is not theft, and treating it as theft would sign
 * the user out of every tab. Within this window the loser gets a fresh ACCESS
 * token and leaves the cookie jar alone - it already holds the winner's new
 * refresh token.
 */
const ROTATION_GRACE_MS = 30 * 1000;

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

async function issueRefreshToken(userId, familyId, tx) {
  const refreshToken = randomBytes(32).toString('base64url');
  const refreshExpiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * DAY_MS);
  const row = await authRepository.createRefreshToken(
    { userId, familyId, tokenHash: hashToken(refreshToken), expiresAt: refreshExpiresAt },
    tx,
  );
  return { row, refreshToken, refreshExpiresAt };
}

/**
 * Verifies credentials and returns a new session plus safe user data.
 * The same error is used for "unknown email", "wrong password" and "deactivated"
 * so the API does not reveal which emails exist.
 *
 * The tokens are for the controller to put in httpOnly cookies. They must never
 * be written into a response body, where page scripts could read them.
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
  await authRepository.deleteExpiredRefreshTokens(user.id);

  const { refreshToken, refreshExpiresAt } = await issueRefreshToken(user.id, randomUUID());

  return {
    session: { ...signAccessToken(user), refreshToken, refreshExpiresAt },
    user: toPublicUser(user),
  };
}

/**
 * Trades a refresh token for a new access token, rotating the refresh token.
 *
 * Every failure is the same 401, so a caller learns nothing about why.
 * A revoked token presented outside the grace window means it was copied, and
 * the sign-in it belongs to is ended - the thief and the real user both have to
 * sign in again, and only one of them knows the password.
 */
export async function refresh(presentedToken) {
  const invalid = () => ApiError.unauthorized('Invalid or expired session');

  if (!presentedToken) throw invalid();

  const current = await authRepository.findRefreshTokenByHash(hashToken(presentedToken));
  if (!current) throw invalid();

  if (current.expiresAt <= new Date()) throw invalid();

  const user = await authRepository.findAuthContextById(current.userId);
  if (!user || !user.isActive) {
    await authRepository.revokeRefreshTokenFamily(current.familyId);
    throw invalid();
  }

  if (current.revokedAt) {
    const justRotated =
      current.replacedById && Date.now() - current.revokedAt.getTime() < ROTATION_GRACE_MS;
    if (!justRotated) {
      await authRepository.revokeRefreshTokenFamily(current.familyId);
      throw invalid();
    }
    // Lost a concurrent refresh race: access token only, keep the jar's cookie.
    return { session: signAccessToken(user), user: toPublicUser(user) };
  }

  const rotated = await withTransaction(async (tx) => {
    const next = await issueRefreshToken(user.id, current.familyId, tx);
    const won = await authRepository.revokeRefreshTokenIfActive(current.id, next.row.id, tx);
    // Another request rotated it between our read and now. Roll back ours.
    if (!won) throw invalid();
    return next;
  }).catch((error) => {
    if (error instanceof ApiError) return null;
    throw error;
  });

  if (!rotated) {
    return { session: signAccessToken(user), user: toPublicUser(user) };
  }

  return {
    session: {
      ...signAccessToken(user),
      refreshToken: rotated.refreshToken,
      refreshExpiresAt: rotated.refreshExpiresAt,
    },
    user: toPublicUser(user),
  };
}

/**
 * Ends the sign-in the refresh token belongs to. Idempotent and silent: an
 * unknown or missing token is simply nothing to revoke.
 */
export async function logout(presentedToken) {
  if (!presentedToken) return;
  const current = await authRepository.findRefreshTokenByHash(hashToken(presentedToken));
  if (current) await authRepository.revokeRefreshTokenFamily(current.familyId);
}
