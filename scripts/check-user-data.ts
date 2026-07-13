import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const email = "user@example.com"; // I don't have the user's email easily available, I'll fetch *all* projects/certs or just list users
  // Actually, I can query by user_id from the logs? "2905fbf7-43c4-4f37-9bb9-3c70097a9a12"
  const userId = "2905fbf7-43c4-4f37-9bb9-3c70097a9a12";

  console.log(`Checking data for user: ${userId}`);

  const projects = await prisma.project.findMany({
    where: { user_id: userId },
  });
  console.log(`Total Projects: ${projects.length}`);
  projects.forEach((p) =>
    console.log(` - Project: ${p.title} (${p.created_at})`)
  );

  const certs = await prisma.authorshipCertificate.findMany({
    where: { user_id: userId },
  });
  console.log(`Total Certificates: ${certs.length}`);
  certs.forEach((c) => console.log(` - Cert: ${c.status} (${c.created_at})`));
}

main()
  .catch((e) => console.error(e))
  .finally(async () => await prisma.$disconnect());
