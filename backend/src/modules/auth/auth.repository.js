import { prisma } from '../../config/prisma.js';

// Authentication-specific database access.
//
// These queries are kept here (and NOT in user.repository) because they are the
// only ones allowed to read the password hash or to run before a company is known.
// user.repository owns every other user query.

/**
 * Login lookup. Returns the full record including passwordHash, so the result
 * must never be sent to a client without going through toPublicUser().
 */
export function findUserByEmail(email) {
  return prisma.user.findUnique({ where: { email } });
}

/**
 * Rebuilds the authenticated request context on every request.
 * isActive is included so a deactivated user can be rejected immediately.
 */
export function findAuthContextById(id) {
  return prisma.user.findUnique({
    where: { id },
    // permissions is read on every request alongside the role, so a permission
    // taken away from a sales rep takes effect immediately rather than when
    // their token expires - the same reasoning that already re-reads the role.
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      companyId: true,
      permissions: true,
      isActive: true,
    },
  });
}

export function updateLastLogin(id) {
  return prisma.user.update({ where: { id }, data: { lastLoginAt: new Date() } });
}
