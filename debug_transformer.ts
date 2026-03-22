import 'dotenv/config';
import { TiptapTransformer } from "@hocuspocus/transformer";
import StarterKit from "@tiptap/starter-kit";
import { AuthorshipExtension } from "./src/extensions/AuthorshipExtension";
import { PrismaClient } from "@prisma/client";
import * as Y from "yjs";

async function main() {
  const prisma = new PrismaClient();
  const projectId = "b9ed26ab-2340-46ca-a440-54165fb67003";

  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!project || !project.content) {
    console.error("Project or content not found");
    return;
  }

  const extensions = [StarterKit, AuthorshipExtension];

  console.log(
    "Project content found. Length:",
    JSON.stringify(project.content).length,
  );

  try {
    const ydoc = TiptapTransformer.toYdoc(
      project.content,
      "default",
      extensions,
    );
    const fragment = ydoc.getXmlFragment("default");

    console.log("Transformation Result:");
    console.log("- Fragment length:", fragment.length);
    console.log(
      "- Is YDoc empty?",
      ydoc.getXmlFragment("default").toString() === "",
    );

    // Convert back to see if it's preserved
    // const backToJson = TiptapTransformer.fromYDoc(ydoc, "default", extensions);
    // console.log('- Reconverting to JSON works?', !!backToJson);
  } catch (error) {
    console.error("Error during transformation:", error);
  }

  await prisma.$disconnect();
}

main();
