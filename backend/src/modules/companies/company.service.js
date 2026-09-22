import { ApiError } from '../../utils/api-error.js';
import { withTransaction } from '../../config/transaction.js';
import { hashPassword } from '../auth/auth.service.js';
import * as companyRepository from './company.repository.js';
import * as userRepository from '../users/user.repository.js';
import { initializeCompanyDefaults } from './company-defaults.js';

// Business rules for companies (tenants). No Prisma calls here.

/**
 * @typedef {import('../../middlewares/require-auth.js').AuthUser} AuthUser
 */

/**
 * Returns a company only if the caller belongs to it.
 * @param {AuthUser} currentUser
 */
export async function getCompanyById(currentUser, id) {
  if (id !== currentUser.companyId) {
    // Same response as "does not exist", so company ids cannot be probed.
    throw ApiError.notFound('Company not found');
  }

  const company = await companyRepository.findById(id);
  if (!company) throw ApiError.notFound('Company not found');

  return company;
}

/** @param {AuthUser} currentUser */
export async function updateCompany(currentUser, id, input) {
  if (id !== currentUser.companyId) {
    throw ApiError.notFound('Company not found');
  }

  if (input.gstin) {
    const existing = await companyRepository.findByGstin(input.gstin);
    if (existing && existing.id !== id) {
      throw new ApiError(409, 'A company with this GSTIN already exists');
    }
  }

  return companyRepository.update(id, input);
}

/**
 * Creates a new tenant together with its first admin user, in one transaction:
 * a company without an admin could never be managed.
 *
 * @param {AuthUser} currentUser  An existing admin. See the limitation in docs/architecture.md:
 *                                any ADMIN can create a tenant, because there is no
 *                                platform-level super admin role yet.
 */
export async function createCompany(currentUser, input) {
  const [nameTaken, emailTaken] = await Promise.all([
    companyRepository.findByName(input.name),
    userRepository.findByEmail(input.admin.email),
  ]);

  if (nameTaken) {
    throw new ApiError(409, 'A company with this name already exists');
  }
  if (emailTaken) {
    throw new ApiError(409, 'A user with this email already exists');
  }
  if (input.gstin) {
    const gstinTaken = await companyRepository.findByGstin(input.gstin);
    if (gstinTaken) {
      throw new ApiError(409, 'A company with this GSTIN already exists');
    }
  }

  const passwordHash = await hashPassword(input.admin.password);

  return withTransaction(async (tx) => {
    const company = await companyRepository.create(
      { name: input.name, gstin: input.gstin ?? null },
      tx,
    );

    const admin = await userRepository.create(
      {
        email: input.admin.email,
        name: input.admin.name,
        passwordHash,
        role: 'ADMIN',
        companyId: company.id,
      },
      tx,
    );

    // Settings row plus default units and taxes, in the same transaction:
    // a company must never exist without settings.
    await initializeCompanyDefaults(company.id, tx);

    return { company, admin };
  });
}
