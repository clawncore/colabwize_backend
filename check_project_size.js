const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function checkProjectSize() {
  const projectId = "f9455f47-9bd3-4bd9-b362-2f7d632c8689";
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { content: true },
    });

    if (project) {
      const size = JSON.stringify(project.content).length;
      console.log(`Project ${projectId} content size: ${size} characters`);
    } else {
      console.log(`Project ${projectId} not found`);
    }
  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkProjectSize();
