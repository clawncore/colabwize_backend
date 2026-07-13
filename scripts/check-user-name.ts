import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const userId = "2905fbf7-43c4-4f37-9bb9-3c70097a9a12";

  console.log(`Checking user: ${userId}`);

  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (user) {
    console.log(`User found:`);
    console.log(` - Email: ${user.email}`);
    console.log(` - Full Name: ${user.full_name}`);
  } else {
    console.log("User not found");
  }
}

main()
  .catch((e) => console.error(e))
  .finally(async () => await prisma.$disconnect());
