const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const docs = await prisma.document.findMany();
  console.log('DOCUMENTS:', docs);
  const chunks = await prisma.documentChunk.count();
  console.log('CHUNKS COUNT:', chunks);
}

main().finally(() => prisma.$disconnect());
