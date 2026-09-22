import { ApiError } from '../../utils/api-error.js';
import { toSkipTake, buildPagination } from '../../utils/pagination.js';
import { hashPassword } from '../auth/auth.service.js';
import * as userRepository from './user.repository.js';

// Business rules for user management. No Prisma calls here - see user.repository.js.
//
// TENANT RULE: every function takes the authenticated user (currentUser) and derives
// the company from currentUser.companyId. A companyId from the request body or query
// is never used.

/**
 * @typedef {import('../../middlewares/require-auth.js').AuthUser} AuthUser
 */

/** @param {AuthUser} currentUser */
export async function listUsers(currentUser, query) {
  const { page, limit, search, role, isActive } = query;
  const { skip, take } = toSkipTake({ page, limit });

  const { items, total } = await userRepository.findManyByCompany(currentUser.companyId, {
    skip,
    take,
    search,
    role,
    isActive,
  });

  return { users: items, pagination: buildPagination({ page, limit, total }) };
}

/** @param {AuthUser} currentUser */
export async function getUserById(currentUser, id) {
  const user = await userRepository.findByIdAndCompany(id, currentUser.companyId);

  // A user in another company must look exactly like a user that does not exist,
  // otherwise the API confirms which ids are real.
  if (!user) throw ApiError.notFound('User not found');

  return user;
}

/** @param {AuthUser} currentUser */
export async function createUser(currentUser, input) {
  const existing = await userRepository.findByEmail(input.email);

  if (existing) {
    throw new ApiError(409, 'A user with this email already exists');
  }

  return userRepository.create({
    email: input.email,
    name: input.name,
    role: input.role,
    passwordHash: await hashPassword(input.password),
    // Always the admin's own company. Never taken from the request.
    companyId: currentUser.companyId,
  });
}

/** @param {AuthUser} currentUser */
export async function updateUser(currentUser, id, input) {
  const target = await userRepository.findByIdAndCompany(id, currentUser.companyId);
  if (!target) throw ApiError.notFound('User not found');

  // An admin changing their own role could lock themselves out of admin routes.
  if (target.id === currentUser.id && input.role && input.role !== target.role) {
    throw ApiError.badRequest('You cannot change your own role');
  }

  if (input.role && input.role !== target.role) {
    await assertNotLastActiveAdmin(currentUser.companyId, target, 'change the role of');
  }

  return userRepository.updateByIdAndCompany(id, currentUser.companyId, input);
}

/** @param {AuthUser} currentUser */
export async function updateUserStatus(currentUser, id, isActive) {
  const target = await userRepository.findByIdAndCompany(id, currentUser.companyId);
  if (!target) throw ApiError.notFound('User not found');

  // Deactivating yourself would immediately lock you out.
  if (target.id === currentUser.id) {
    throw ApiError.badRequest('You cannot change your own status');
  }

  if (!isActive) {
    await assertNotLastActiveAdmin(currentUser.companyId, target, 'deactivate');
  }

  return userRepository.updateStatus(id, currentUser.companyId, isActive);
}

/**
 * Prevents a company from ending up with no active admin, which would leave it
 * unmanageable.
 */
async function assertNotLastActiveAdmin(companyId, target, action) {
  if (target.role !== 'ADMIN' || !target.isActive) return;

  const activeAdmins = await userRepository.countByCompany(companyId, {
    role: 'ADMIN',
    isActive: true,
  });

  if (activeAdmins <= 1) {
    throw ApiError.badRequest(`You cannot ${action} the last active admin of the company`);
  }
}
