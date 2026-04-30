
import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const latest = await prisma.supportMessage.findMany({
      take: 10,
      orderBy: { received_at: 'desc' },
      select: { id: true, subject: true, received_at: true, imap_uid: true }
    });
    console.log('Latest 10 messages:', JSON.stringify(latest, null, 2));
    
    const count = await prisma.supportMessage.count();
    console.log('Total support messages:', count);
    
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
