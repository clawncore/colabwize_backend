
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const titles = ['Study_Watch_Blueprint', 'GE_IEEE Batch 13'];
  const projects = await prisma.project.findMany({
    where: {
      title: {
        in: titles
      }
    },
    select: {
      id: true,
      title: true,
      word_count: true,
      content: true,
      created_at: true
    }
  });

  console.log('Found Projects:');
  projects.forEach((p: any) => {
    const contentLength = typeof p.content === 'string' ? p.content.length : 0;
    console.log(`ID: ${p.id}, Title: ${p.title}, Words: ${p.word_count}, Content Length: ${contentLength}`);
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
