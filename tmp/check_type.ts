
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const project = await prisma.project.findUnique({
    where: { id: '7244d433-87f5-4407-8b94-b7b3ec931adc' },
    select: { content: true }
  });
  if (project) {
    console.log('Project found.');
    console.log('Type of content:', typeof project.content);
    if (typeof project.content === 'string') {
        console.log('Content is a string. Length:', project.content.length);
        console.log('Start of content:', project.content.substring(0, 100));
    } else {
        console.log('Content is an object:', JSON.stringify(project.content).substring(0, 100));
    }
  } else {
    console.log('Project NOT found.');
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
