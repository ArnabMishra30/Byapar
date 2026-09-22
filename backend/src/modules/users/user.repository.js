import { prisma } from '../../config/prisma.js';

// All non-authentication database access for users. Services never call Prisma directly.
// Login and token lookups live in auth.repository.js.
//
// TENANT RULE: every method that reads or writes a specific user takes an explicit
// companyId, so a caller cannot accidentally reach another company's data.

/** The only user fields allowed to leave the backend. passwordHash is never listed. */
const PUBLIC_FIELDS = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
  companyId: true,
  createdAt: true,
  updatedAt: true,
};

export function findByEmail(email) {
  return prisma.user.findUnique({ where: { email }, select: PUBLIC_FIELDS });
}

export function findById(id) {
  return prisma.user.findUnique({ where: { id }, select: PUBLIC_FIELDS });
}

/** Company-scoped lookup. Returns null if the user belongs to another company. */
export function findByIdAndCompany(id, companyId) {
  return prisma.user.findFirst({ where: { id, companyId }, select: PUBLIC_FIELDS });
}

/**
 * Paginated list of one company's users.
 * @param {string} companyId
 * @param {{ skip: number, take: number, search?: string, role?: string, isActive?: boolean }} options
 */
export async function findManyByCompany(companyId, { skip, take, search, role, isActive }) {
  const where = { companyId };

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (role) where.role = role;
  if (typeof isActive === 'boolean') where.isActive = isActive;

  const [items, total] = await Promise.all([
    prisma.user.findMany({ where, select: PUBLIC_FIELDS, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.user.count({ where }),
  ]);

  return { items, total };
}

export function countByCompany(companyId, where = {}) {
  return prisma.user.count({ where: { companyId, ...where } });
}

/** @param {{ email: string, name: string, passwordHash: string, role: string, companyId: string }} data */
export function create(data, client = prisma) {
  return client.user.create({ data, select: PUBLIC_FIELDS });
}

/** Company-scoped update. Returns null when the user is not in that company. */
export async function updateByIdAndCompany(id, companyId, data) {
  const result = await prisma.user.updateMany({ where: { id, companyId }, data });
  if (result.count === 0) return null;
  return findById(id);
}

/** Separate from update() because activating/deactivating is its own action. */
export function updateStatus(id, companyId, isActive) {
  return updateByIdAndCompany(id, companyId, { isActive });
}

export { PUBLIC_FIELDS };
