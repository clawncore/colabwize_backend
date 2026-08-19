
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const ids = ['7244d433-87f5-4407-8b94-b7b3ec931adc'];
  for (const id of ids) {
    const project = await prisma.project.findUnique({
      where: { id },
      select: { id: true, title: true, content: true }
    });
    if (project && project.content && typeof project.content === 'object') {
        processContent(project.content);
    } else {
        console.log(`Project ${id} not found or content is not an object`);
    }
  }
}

function processContent(content: any) {
    const nodeCounts: Record<string, number> = {};
    let imageCount = 0;
    
    function traverse(node: any) {
        if (!node) return;
        nodeCounts[node.type] = (nodeCounts[node.type] || 0) + 1;
        if (node.type === 'image' || node.type === 'imageExtension') {
            imageCount++;
            console.log('Found Image Node:', JSON.stringify(node).substring(0, 500));
        }
        if (node.content && Array.isArray(node.content)) {
            node.content.forEach(traverse);
        }
    }
    
    traverse(content);
    console.log('Node Counts:', nodeCounts);
    console.log('Total Images:', imageCount);
}

main().catch(console.error).finally(() => prisma.$disconnect());
