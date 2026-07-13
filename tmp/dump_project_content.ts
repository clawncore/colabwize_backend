
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const ids = ['7244d433-87f5-4407-8b94-b7b3ec931adc', '6be99909-8907-44fc-9b3b-e3adab9c38ab'];
  for (const id of ids) {
    const project = await prisma.project.findUnique({
      where: { id },
      select: { id: true, title: true, content: true, workspace_id: true }
    });
    if (project) {
        console.log(`--- Project: ${project.title} (${project.id}) ---`);
        console.log(`Collab: ${project.workspace_id !== null}`);
        console.log(`Content Type: ${typeof project.content}`);
        if (typeof project.content === 'string') {
            console.log('Content (HTML Preview):', project.content.substring(0, 500));
        } else {
            console.log('Content (JSON Preview):', JSON.stringify(project.content).substring(0, 500));
        }
    } else {
        console.log(`Project ${id} not found`);
    }
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
