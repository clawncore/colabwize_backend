
import { prisma } from "../src/lib/prisma";
import { SubscriptionService } from "../src/services/subscriptionService";
import { CreditService } from "../src/services/CreditService";
import { randomUUID } from "crypto";

async function verifyPAYG() {
    console.log("🚀 Starting PAYG Verification...");

    const email = `verify_payg_${Date.now()}@test.com`;
    const userId = `verify-payg-${Date.now()}`;

    // 1. Create Test User
    console.log(`\n1. Creating Test User: ${email}`);
    await prisma.user.create({
        data: {
            id: userId,
            email,
            full_name: "PAYG Tester",
        },
    });

    // Ensure Free Plan
    await SubscriptionService.upsertSubscription(userId, {
        plan: "free",
        status: "active",
    });
    console.log("✅ User created with Free Plan (limit: 3 scans).");

    // 2. Consume Free Limits
    console.log("\n2. Consuming Free Plan Limits...");

    for (let i = 1; i <= 3; i++) {
        const result = await SubscriptionService.consumeAction(userId, "scan");
        console.log(`   Scan ${i}: Allowed=${result.allowed}, Source=${result.source}`);
        if (!result.allowed || result.source !== "PLAN") {
            throw new Error(`❌ Failed at Scan ${i}. Expected PLAN consumption.`);
        }
    }
    console.log("✅ Free Plan limits consumed.");

    // 3. Attempt Over-Limit (Expect Blocked)
    console.log("\n3. Attempting Scan 4 (Should be BLOCKED)...");
    const blockedResult = await SubscriptionService.consumeAction(userId, "scan");
    console.log(`   Scan 4 Result: Allowed=${blockedResult.allowed}, Source=${blockedResult.source}`);

    if (blockedResult.allowed) {
        throw new Error("❌ Failed. Scan 4 should have been BLOCKED.");
    }
    console.log("✅ Correctly Blocked (No Credits).");

    // 4. Add Credits
    console.log("\n4. Adding 500 Credits...");
    await CreditService.addCredits(userId, 500, "PURCHASE", "test_ref", "Test Purchase");
    const balance = await CreditService.getBalance(userId);
    console.log(`   New Balance: ${balance}`);
    if (balance !== 500) throw new Error("❌ Balance Update Failed.");
    console.log("✅ Credits Added.");

    // 5. Attempt Scan 4 Again (Expect CREDIT)
    console.log("\n5. Retrying Scan 4 (Should use CREDIT)...");
    const creditResult = await SubscriptionService.consumeAction(userId, "scan");
    console.log(`   Scan 4 Result: Allowed=${creditResult.allowed}, Source=${creditResult.source}, Cost=${creditResult.cost}`);

    if (!creditResult.allowed || creditResult.source !== "CREDIT") {
        throw new Error("❌ Failed. Scan 4 should have used CREDIT.");
    }

    const newBalance = await CreditService.getBalance(userId);
    console.log(`   Remaining Balance: ${newBalance}`);
    if (newBalance !== 400) throw new Error("❌ Deduction Incorrect. Expected 400.");
    console.log("✅ Correctly consumed Credits.");

    // Cleanup
    console.log("\nCleaning up...");
    await prisma.user.delete({ where: { id: userId } });

    console.log("\n🎉 PAYG VERIFICATION SUCCESSFUL!");
}

verifyPAYG()
    .catch((e) => {
        console.error("\n❌ VERIFICATION FAILED:", e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
