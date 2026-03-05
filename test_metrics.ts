import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const workspaces = await prisma.workspace.findMany({ take: 1 });
  if (workspaces.length === 0) {
    console.log("No workspaces found");
    return;
  }

  const wsId = workspaces[0].id;
  console.log("Checking workspace:", wsId);

  try {
    const projects = await prisma.project.findMany({
      where: { workspace_id: wsId },
      include: { user: true },
      take: 5,
      orderBy: { updated_at: "desc" },
    });
    console.log("Recent Workspace Projects:", projects.length);
    projects.forEach((p) => console.log(`- ${p.title} (by ${p.user.email})`));

    const tasks = await prisma.workspaceTask.findMany({
      where: { workspace_id: wsId },
      include: { creator: true },
      take: 5,
      orderBy: { updated_at: "desc" },
    });
    console.log("Recent Workspace Tasks:", tasks.length);
    tasks.forEach((t) => console.log(`- ${t.title} (by ${t.creator.email})`));
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
