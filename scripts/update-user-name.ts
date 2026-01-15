import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const userId = "2905fbf7-43c4-4f37-9bb9-3c70097a9a12";
  const newName = "Maro E";

  console.log(`Updating user: ${userId} to name: ${newName}`);

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: { full_name: newName },
  });

  console.log(`User updated:`, updatedUser);
}

main()
  .catch((e) => {
    console.error("Error updating user:", e);
    process.exit(1);
  })
  .finally(async () => await prisma.$disconnect());
