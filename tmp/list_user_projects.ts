
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const userId = 'baeff593-d3ce-4d09-ba45-6609007ecb8d';
  const projects = await prisma.project.findMany({
    where: { 
      OR: [
        { user_id: userId },
        { collaborators: { some: { user_id: userId } } },
        { workspace: { members: { some: { user_id: userId } } } }
      ]
    },
    select: {
      id: true,
      title: true,
      workspace_id: true,
      content: true,
      created_at: true
    },
    orderBy: {
      created_at: 'desc'
    }
  });

  console.log('Found Projects (' + projects.length + '):');
  projects.forEach(p => {
    const contentLength = typeof p.content === 'string' ? p.content.length : (p.content === null ? 0 : JSON.stringify(p.content).length);
    const contentType = typeof p.content;
    const isCollaborative = p.workspace_id !== null;
    console.log(`ID: ${p.id}, Collab: ${isCollaborative}, Title: ${p.title}, Content Length: ${contentLength}, Type: ${contentType}`);
  });
}
main().catch(console.error).finally(() => prisma.$disconnect());
