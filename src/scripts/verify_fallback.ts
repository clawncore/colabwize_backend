
import { PrismaClient } from "@prisma/client";
import { SubscriptionService } from "../services/subscriptionService";
import { CreditService } from "../services/CreditService";

const prisma = new PrismaClient();

async function runVerification() {
    console.log("🚀 Starting Auto-Fallback Verification...");

    try {
        // 1. Setup Test User
        let user = await prisma.user.findFirst({
            where: { email: "test_verification@example.com" }
        });

        if (!user) {
            user = await prisma.user.create({
                data: {
                    email: "test_verification@example.com",
                    full_name: "Test Verification User",
                    auto_use_credits: true,
                }
            });

            // Initialize Credit Balance
            await prisma.creditBalance.create({
                data: {
                    user_id: user.id,
                    balance: 10,
                    lifetime_purchased: 10
                }
            });
            console.log("Created test user:", user.id);
        } else {
            // Reset state
            await prisma.user.update({
                where: { id: user.id },
                data: { auto_use_credits: true }
            });

            // Reset Credit Balance
            await prisma.creditBalance.upsert({
                where: { user_id: user.id },
                create: { user_id: user.id, balance: 10, lifetime_purchased: 10 },
                update: { balance: 10 }
            });

            // Clear usage
            await prisma.usageTracking.deleteMany({ where: { user_id: user.id } });
            console.log("Reset test user state:", user.id);
        }

        const userId = user.id;
        const FEATURE = "scan"; // Citation Audit
        const COST = 1; // 1000 words = 1 credit

        // 2. EXHAUST PLAN LIMITS
        // Assume Free plan has limits. We force usage to match limit.
        const limits = SubscriptionService.getPlanLimits("free");
        const limit = limits.scans_per_month;

        if (limit > 0) {
            // Insert usage to max out limit
            const now = new Date();
            const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
            const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

            await prisma.usageTracking.create({
                data: {
                    user_id: userId,
                    feature: FEATURE,
                    count: limit,
                    period_start: periodStart,
                    period_end: periodEnd
                }
            });
            console.log(`✅ Exhausted Plan Limits (${limit}/${limit})`);
        } else {
            console.log("ℹ️ Plan has 0 limit, already exhausted.");
        }

        // 3. TEST CASE 1: Auto-Use ON, Credits Available
        console.log("\n🧪 Case 1: Auto-Use ON, 10 Credits... Expecting SUCCESS (Credit)");
        const result1 = await SubscriptionService.consumeAction(userId, FEATURE, { wordCount: 900 });

        if (result1.allowed && result1.source === "CREDIT") {
            console.log("✅ PASSED: Consumed 1 Credit via Auto-Fallback.");
        } else {
            console.error("❌ FAILED: Expected Source 'CREDIT', got:", result1);
        }

        // 4. TEST CASE 2: Auto-Use OFF, Credits Available
        console.log("\n🧪 Case 2: Auto-Use OFF, Credits Available... Expecting BLOCK");
        await SubscriptionService.updateAutoUseCredits(userId, false);

        const result2 = await SubscriptionService.consumeAction(userId, FEATURE, { wordCount: 900 });

        if (!result2.allowed && result2.message?.includes("Enable Auto-Use")) {
            console.log("✅ PASSED: Blocked correctly with Auto-Use message.");
        } else {
            console.error("❌ FAILED: Expected Block, got:", result2);
        }

        // 5. TEST CASE 3: Auto-Use ON, Insufficient Credits
        console.log("\n🧪 Case 3: Auto-Use ON, 0 Credits... Expecting BLOCK (No Credits)");
        await SubscriptionService.updateAutoUseCredits(userId, true);

        // Drain credits via DB
        await prisma.creditBalance.update({ where: { user_id: userId }, data: { balance: 0 } });

        const result3 = await SubscriptionService.consumeAction(userId, FEATURE, { wordCount: 900 });

        if (!result3.allowed && result3.message?.includes("enough credits")) {
            console.log("✅ PASSED: Blocked correctly due to insufficient credits.");
        } else {
            console.error("❌ FAILED: Expected No Credits Block, got:", result3);
        }

        // Cleanup
        await prisma.usageTracking.deleteMany({ where: { user_id: userId } });
        // Reset credits for next run if needed, or leave drained.
        // await prisma.user.delete({ where: { id: userId } }); // Keep user for debug
        console.log("\n🧹 Cleanup Complete.");

    } catch (error) {
        console.error("Verification Failed with Error:", error);
    } finally {
        await prisma.$disconnect();
    }
}

runVerification();
