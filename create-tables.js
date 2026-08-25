const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "users" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "email" TEXT NOT NULL,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `;
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "projects" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "user_id" TEXT,
      "title" TEXT,
      "status" TEXT NOT NULL DEFAULT 'active',
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `;
  console.log('Tables created successfully');
}

main().catch(console.error).finally(() => prisma.$disconnect());