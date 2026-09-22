import { PrismaClient } from '@prisma/client';
import { isProduction } from './env.js';

// One PrismaClient for the whole app. Creating more than one opens extra
// connection pools and will exhaust PostgreSQL connections.
export const prisma = new PrismaClient({
  log: isProduction ? ['error'] : ['error', 'warn'],
});

export async function disconnectPrisma() {
  await prisma.$disconnect();
}
