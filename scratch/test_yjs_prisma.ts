import { prisma } from "../src/lib/prisma";
import * as Y from "yjs";

async function main() {
  // 1. Fetch any project
  const project = await prisma.project.findFirst({
    select: { id: true, content: true, ydoc: true }
  });

  if (!project) {
    console.error("No projects found in database!");
    return;
  }

  const projectId = project.id;
  console.log("Selected project ID:", projectId);
  console.log("Original project content:", JSON.stringify(project.content).substring(0, 100));
  console.log("Original ydoc bytes exists:", !!project.ydoc);

  // 2. Create Yjs document and write some text
  const ydoc = new Y.Doc();
  const ytext = ydoc.getText("default");
  ytext.insert(0, "Test binary Yjs persistence");

  // 3. Encode to update and convert to Buffer for Prisma
  const update = Y.encodeStateAsUpdate(ydoc);
  const buffer = Buffer.from(update);

  // 4. Update the project with the ydoc binary
  await prisma.project.update({
    where: { id: projectId },
    data: {
      ydoc: buffer
    }
  });

  console.log("Successfully wrote ydoc to database.");

  // 5. Read back from database
  const updatedProject = await prisma.project.findUnique({
    where: { id: projectId },
    select: { ydoc: true }
  });

  if (!updatedProject || !updatedProject.ydoc) {
    console.error("Failed to read back ydoc!");
    return;
  }

  console.log("Read back ydoc bytes length:", updatedProject.ydoc.length);

  // 6. Apply update to a fresh Y.Doc
  const loadedYdoc = new Y.Doc();
  Y.applyUpdate(loadedYdoc, new Uint8Array(updatedProject.ydoc));
  
  console.log("Loaded text from Yjs binary:", loadedYdoc.getText("default").toString());
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
