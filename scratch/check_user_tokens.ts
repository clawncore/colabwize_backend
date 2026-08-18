import { prisma } from "../src/lib/prisma";

async function main() {
  const users = await prisma.user.findMany({
    where: {
      google_access_token: { not: null }
    },
    select: {
      id: true,
      email: true,
      google_access_token: true,
      google_refresh_token: true,
      google_token_expires_at: true
    }
  });

  console.log("Users with Google Drive tokens connected:", JSON.stringify(users, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
