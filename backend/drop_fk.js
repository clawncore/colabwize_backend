const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL
    }
  }
});

async function main() {
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "writing_reports" DROP CONSTRAINT IF EXISTS "writing_reports_owner_id_fkey"`);
    console.log("Successfully dropped the problematic foreign key.");
  } catch (e) {
    console.error("Error:", e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
