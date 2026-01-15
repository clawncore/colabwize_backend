
const fetch = require('node-fetch');

async function checkApi() {
  try {
    // We can't easily authenticate as the user without a token.
    // Instead, I'll relies on the backend logs or try to look at the 'SubscriptionService' logic again.
    // Actually, I can use the 'check-sub-standalone.js' if I fix the import issue.
    // The previous error for standalone script was likely due to missing 'dotenv' for DB connection string.
    
    require('dotenv').config({ path: '.env' }); // Try to load .env
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    
    const userId = '2905fbf7-43c4-4f37-9bb9-3c70097a9a12';
    
    console.log(`Checking DB for user: ${userId}`);
    const sub = await prisma.subscription.findUnique({ where: { user_id: userId } });
    console.log('Subscription in DB:', sub);
    
    // Also check if I can 'simulate' the getActivePlan logic
    if (!sub) {
        console.log("Logic says: Free (no sub)");
    } else {
        const isActive = ["active", "trialing"].includes(sub.status);
        console.log(`Logic says: ${isActive ? sub.plan : "Free (status mismatch)"}`);
        console.log(`Status is: ${sub.status}`);
    }

  } catch (e) {
    console.error(e);
  }
}

checkApi();
