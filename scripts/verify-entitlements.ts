
import { PrismaClient } from '@prisma/client';
import { EntitlementService } from '../src/services/EntitlementService';
import { SubscriptionService } from '../src/services/subscriptionService';
import { UsageService } from '../src/services/usageService';

const prisma = new PrismaClient();

async function main() {
    console.log("Starting Entitlements Verification...");

    // 1. Setup Test User
    const email = `test-entitlement-${Date.now()}@example.com`;
    console.log(`Creating test user: ${email}`);
    const user = await prisma.user.create({
        data: {
            email,
            full_name: 'Test User'
        }
    });

    try {
        const userId = user.id;

        // 2. Verify Initial State (Free Plan)
        console.log("Verifying Free Plan...");
        // Force rebuild just in case (though upsert usually handles it, creating user doesn't create sub)
        await EntitlementService.rebuildEntitlements(userId);
        let ent = await EntitlementService.getEntitlements(userId);
        console.log("Free Entitlements:", JSON.stringify(ent?.features, null, 2));

        if (ent?.plan !== 'free') throw new Error("Expected free plan");
        // Check scan limit (3 for free)
        // @ts-ignore
        if (ent?.features['scans_per_month'].limit !== 3) throw new Error("Expected 3 scans for free");

        // 3. Upgrade to Researcher (Unlimited)
        console.log("Upgrading to Researcher...");
        await SubscriptionService.upsertSubscription(userId, {
            plan: 'researcher',
            status: 'active',
            lemonsqueezy_customer_id: `cust_${Date.now()}`,
            lemonsqueezy_subscription_id: `sub_${Date.now()}`,
            current_period_start: new Date(),
            current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        });

        ent = await EntitlementService.getEntitlements(userId);
        console.log("Researcher Entitlements:", JSON.stringify(ent?.features, null, 2));
        if (ent?.plan !== 'researcher') throw new Error("Expected researcher plan");
        // @ts-ignore
        if (ent?.features['ai_chat'].unlimited !== true) throw new Error("Expected unlimited ai_chat");

        // 4. Downgrade to Student (Finite Limit)
        console.log("Downgrading to Student...");
        await SubscriptionService.upsertSubscription(userId, {
            plan: 'student',
            status: 'active'
        });

        ent = await EntitlementService.getEntitlements(userId);
        // @ts-ignore
        const scanRights = ent?.features['scans_per_month'];
        console.log("Student Entitlements (Scans):", scanRights);

        if (scanRights.limit !== 25) throw new Error("Expected 25 scans for student");

        // 5. Consume Entitlement
        console.log("Consuming 1 scan...");
        const consumed = await EntitlementService.consumeEntitlement(userId, 'scans_per_month');
        if (!consumed) throw new Error("Consumption failed");

        ent = await EntitlementService.getEntitlements(userId);
        // @ts-ignore
        const newRights = ent?.features['scans_per_month'];
        console.log("After Consumption:", newRights);

        if (newRights.remaining !== 24) throw new Error("Expected 24 remaining");

        // 6. Verify UsageService Routing
        console.log("Verifying UsageService check...");
        const check = await UsageService.checkUsageLimit(userId, 'scans_per_month');
        console.log("UsageService Check:", check);

        if (!check.allowed || check.limit !== 24) throw new Error("UsageService should reflect entitlement remaining");

        // 7. Verify Citation Check Mapping
        console.log("Verifying citation_check mapping...");
        // citation_audit limit is 25 for student
        const auditCheck = await EntitlementService.checkEligibility(userId, 'citation_check');
        console.log("Citation Check Eligibility:", auditCheck);

        if (!auditCheck.allowed) throw new Error("Should be allowed for citation_check");
        if (auditCheck.remaining === undefined || auditCheck.remaining !== 25) throw new Error(`Expected 25 remaining for citation_check, got ${auditCheck.remaining}`);

        console.log("Consuming citation_check...");
        await EntitlementService.consumeEntitlement(userId, 'citation_check');

        const entAfter = await EntitlementService.getEntitlements(userId);
        // @ts-ignore
        const auditRights = entAfter?.features['citation_audit'];
        console.log("After Citation Consumption:", auditRights);

        if (auditRights.remaining !== 24) throw new Error("Expected 24 remaining for citation_audit after consuming citation_check");


        console.log("SUCCESS: Entitlements Verification Passed!");

    } catch (e) {
        console.error("Verification Failed:", e);
        process.exit(1);
    } finally {
        // Cleanup
        await prisma.user.delete({ where: { id: user.id } });
        await prisma.$disconnect();
    }
}

main();
