import { prisma } from "../src/lib/prisma";

const userId = process.argv[2];

async function checkSubscription() {
  if (!userId) {
    console.error("Please provide a user ID");
    process.exit(1);
  }

  console.log(`Checking subscription for user: ${userId}`);

  try {
    const subscription = await prisma.subscription.findUnique({
      where: { user_id: userId },
    });

    console.log("Subscription record:", subscription);

    if (subscription) {
      console.log(`Plan: ${subscription.plan}`);
      console.log(`Status: ${subscription.status}`);
    } else {
      console.log("No subscription found for this user.");
    }
  } catch (error) {
    console.error("Error checking subscription:", error);
  } finally {
    await prisma.$disconnect();
  }
}

checkSubscription();
