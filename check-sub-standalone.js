
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const userId = '2905fbf7-43c4-4f37-9bb9-3c70097a9a12';

async function main() {
  try {
    console.log(`Checking subscription for user: ${userId}`);
    const subscription = await prisma.subscription.findUnique({
      where: { user_id: userId },
    });
    console.log('Subscription:', subscription);
    
    if (subscription) {
      console.log(`Plan: ${subscription.plan} (Type: ${typeof subscription.plan})`);
      console.log(`Status: ${subscription.status}`);
    } else {
      console.log('No subscription found.');
    }
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
