import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  try {
    console.log("Starting debug script...");
    const total = await prisma.user.count();
    console.log("Total users count:", total);

    const users = await prisma.user.findMany({
      take: 10,
      select: { id: true, email: true, full_name: true }
    });
    console.log("Users found:", JSON.stringify(users, null, 2));

    const wherePaid = { subscription: { some: { status: 'active' } } };
    const paidCount = await prisma.user.count({ where: wherePaid });
    console.log("Paid users count:", paidCount);

  } catch (error) {
    console.error("DEBUG ERROR:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
