import { ZoteroService } from "./src/services/zoteroService.js";
import { prisma } from "./src/lib/prisma.js";

async function main() {
  const itemData = {
      key: "X7R5S3J8",
      version: 123,
      data: {
          key: "X7R5S3J8",
          itemType: "journalArticle",
          title: "The Impact of Social Media",
          creators: [{ lastName: "Smith", firstName: "John" }],
          date: "2023",
          DOI: "10.1000/123",
          url: "https://example.com"
      },
      meta: { creatorSummary: "Smith et al." }
  };
  
  const project = await prisma.project.findFirst();
  const user = await prisma.user.findFirst({ where: { id: project?.user_id } });
  
  if (!user || !project) {
    console.error("No valid user or project found");
    return;
  }
  
  try {
      console.log("Attempting import...");
      const result = await ZoteroService.importItem(user.id, project.id, itemData);
      console.log("Success:", !!result);
  } catch (err: any) {
      console.error("FAIL:", err.message);
  }
}
main();
