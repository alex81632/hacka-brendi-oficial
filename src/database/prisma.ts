import { PrismaClient } from '@prisma/client';

// Criando uma instância global do PrismaClient para evitar
// múltiplas instâncias durante hot-reloading
const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: ['query', 'error', 'warn'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;