import { prisma, disconnectPrisma } from './src/config/prisma.js';

async function main() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      company: {
        select: { id: true, name: true }
      }
    }
  });
  console.log('USERS IN DB:', JSON.stringify(users, null, 2));
}

main().finally(disconnectPrisma);
