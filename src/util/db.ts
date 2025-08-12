import { PrismaClient } from '../../generated/prisma';

export * from '../../generated/prisma';

const prisma = new PrismaClient();
let isConnected = false;
process.on('exit', () => {
  void prisma.$disconnect();
});
export async function getDb() {
  if (!isConnected) {
    await prisma.$connect();
    isConnected = true;
  }

  return prisma;
}
export type PrismaDb = Awaited<ReturnType<typeof getDb>>;
