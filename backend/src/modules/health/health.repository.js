import { prisma } from '../../config/prisma.js';

/**
 * Cheapest possible round trip to PostgreSQL.
 * Exists so that no file outside a repository or src/config touches Prisma.
 */
export async function checkConnection() {
  await prisma.$queryRaw`SELECT 1`;
}
