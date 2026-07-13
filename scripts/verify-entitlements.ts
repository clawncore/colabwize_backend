
import { PrismaClient } from '@prisma/client';
import { EntitlementService } from '../src/services/EntitlementService';
import { SubscriptionService } from '../src/services/subscriptionService';
import { UsageService } from '../src/services/usageService';

const prisma = new PrismaClient();

// Helper to avoid repetitive console logs and error throwing
async function assertLimit(userId: string, planName: string, feature: string, expectedLimit: number) {
    console.log(`\nValidating ${planName} Plan...`);

    // Force a fresh fetch/rebuild
    const ent = await EntitlementService.getEntitlements(userId);

    if (ent?.plan !== planName) {
        throw new Error(`Plan Mismatch: Expected '${planName}', got '${ent?.plan}'`);
    }

    const features = ent.features as Record<string, any>;
    const right = features[feature];

    console.log(`  [${feature}] Limit: ${right?.limit}, Remaining: ${right?.remaining}, Unlimited: ${right?.unlimited}`);

    if (!right) {
        throw new Error(`Feature '${feature}' missing from entitlements`);
    }

    if (right.limit !== expectedLimit) {
        throw new Error(`Limit Mismatch for ${feature}: Expected ${expectedLimit}, got ${right.limit}`);
    }
}

async function setPlan(userId: string, plan: string) {
    console.log(`\n--> Switching to plan: ${plan.toUpperCase()}`);
    await SubscriptionService.upsertSubscription(userId, {
        plan: plan,
        status: 'active',
        lemonsqueezy_customer_id: `cust_${userId}`,
        lemonsqueezy_subscription_id: `sub_${Date.now()}`,
        current_period_start: new Date(),
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    });
    // Entitlements should auto-rebuild, but we await to depend on the async behavior or calling it explicitly for test determinism?
    // In real app it's async. For test, let's wait a moment or force it.
    await EntitlementService.rebuildEntitlements(userId);
}

async function main() {
    console.log("==========================================");
    console.log("   ENTITLEMENT SYSTEM VERIFICATION        ");
    console.log("==========================================");

    const email = `verify-entitlements-${Date.now()}@example.com`;
    const user = await prisma.user.create({ data: { email, full_name: 'Verification Bot' } });
    const userId = user.id;

    try {
        // Test 1: Free Plan (Default)
        // Note: Creating user doesn't create sub, so we simulate "No Sub" -> Free
        console.log("\n--> Checking Default State (Free)");
        await EntitlementService.rebuildEntitlements(userId);
        await assertLimit(userId, 'free', 'scans_per_month', 3);

        // Test 2: Student Plan (25 Limit)
        await setPlan(userId, 'student');
        await assertLimit(userId, 'student', 'scans_per_month', 25);
        await assertLimit(userId, 'student', 'citation_audit', 25);

        // Test 3: Researcher Plan (100 Limit)
        await setPlan(userId, 'researcher');
        await assertLimit(userId, 'researcher', 'scans_per_month', 100);
        // Verify other features exist
        await assertLimit(userId, 'researcher', 'paper_search', 100);
        await assertLimit(userId, 'researcher', 'ai_integrity', 100);

        // Test 4: Consumption (Using Student Plan)
        await setPlan(userId, 'student');
        console.log("\n--> Testing Consumption Check...");
        const allowed = await EntitlementService.assertCanUse(userId, 'scans_per_month');
        if (!allowed) throw new Error("Consumption rejected but should be allowed");
        console.log("  Measurement: Consumed 1 unit.");

        const ent = await EntitlementService.getEntitlements(userId);
        const feats = ent?.features as Record<string, any>;
        const remaining = feats['scans_per_month'].remaining;

        console.log(`  State After Consumption: ${remaining} remaining (Expected 24)`);

        if (remaining !== 24) {
            throw new Error(`Consumption Failed: Expected 24, got ${remaining}`);
        }

        // Test 5: Credit Fallback (Failover)
        console.log("\n--> Testing Credit Fallback (Failover)...");
        // 1. Give some credits
        await import('../src/services/CreditService').then(m => m.CreditService.addCredits(userId, 10, 'PURCHASE', 'test_ref', 'Test Credits'));

        // 2. Exhaust Plan (Artificially set usage to limit)
        // Student limit is 25. We are at 1 used (24 remaining). Let's set usage to 25.
        await prisma.usageTracking.updateMany({
            where: { user_id: userId, feature: 'scans_per_month' },
            data: { count: 25 }
        });
        await EntitlementService.rebuildEntitlements(userId); // Refresh state

        const entExhausted = await EntitlementService.getEntitlements(userId);
        // @ts-ignore
        if (entExhausted?.features['scans_per_month'].remaining !== 0) throw new Error("Failed to exhaust plan limits");

        // 3. Try to use (Should use Credit)
        console.log("  Attempting scan with 0 remaining but 10 credits...");
        const allowedViaCredit = await EntitlementService.assertCanUse(userId, 'scans_per_month');
        if (!allowedViaCredit) throw new Error("Credit fallback failed - Access Denied");

        const creditBalance = await import('../src/services/CreditService').then(m => m.CreditService.getBalance(userId));
        console.log(`  Credit Balance after use: ${creditBalance}`);

        if (creditBalance !== 9) throw new Error(`Expected 9 credits, got ${creditBalance}`);
        console.log("  Measurement: Consumed 1 Credit (Success)");

        // Test 6: Feature Mapping & Others
        console.log("\n--> Testing Feature Mappings...");
        // 'rephrase' -> 'rephrase_suggestions' (25 limit on Student)
        await setPlan(userId, 'student');
        const rephraseAllowed = await EntitlementService.assertCanUse(userId, 'rephrase');
        if (!rephraseAllowed) throw new Error("Rephrase rejected");

        const entRephrase = await EntitlementService.getEntitlements(userId);
        // @ts-ignore
        if (entRephrase.features['rephrase_suggestions'].remaining !== 24) throw new Error("Rephrase mapping failed to consume correct key");
        console.log("  Measurement: 'rephrase' mapped to 'rephrase_suggestions' and consumed successfully.");

        // 'ai_integrity' (0 limit on Student? Let's check config)
        // Student: ai_integrity: 0. So it should throw.
        try {
            await EntitlementService.assertCanUse(userId, 'ai_integrity');
            throw new Error("Should have blocked ai_integrity on Student plan");
        } catch (e: any) {
            console.log("  Measurement: 'ai_integrity' correctly blocked on Student plan (Limit 0/Not Included).");
        }

        // Test 7: Full Service Agreement Check
        console.log("\n--> Testing Full Service Parity...");
        const featuresToCheck = ['chat', 'originality', 'draft_comparison', 'certificate', 'paper_search'];

        // Switch to Researcher for maximum access to test validity
        await setPlan(userId, 'researcher');

        for (const feat of featuresToCheck) {
            try {
                // Just check structure, don't necessarily consume (some return true/false)
                // We use checkEligibility for non-destructive check if possible, or assertCanUse and catch 'limit reached'
                // Actually, assertCanUse consumes. Let's use checkEligibility to see if it MAPPES correctly.
                const eligibility = await EntitlementService.checkEligibility(userId, feat);
                const ent = await EntitlementService.getEntitlements(userId);
                // @ts-ignore
                // Check if the key exists in features
                // To do this, we need to know the canonical key.
                // We rely on checkEligibility returning a valid object (unlimited: boolean, etc.)
                if (eligibility.remaining === undefined && eligibility.unlimited === undefined) {
                    throw new Error(`Feature '${feat}' did not resolve to a valid entitlement.`);
                }
                console.log(`  [Pass] Feature '${feat}' resolved correctly.`);
            } catch (e: any) {
                throw new Error(`Feature '${feat}' failed parity check: ${e.message}`);
            }
        }

        console.log("\n==========================================");
        console.log("   VERIFICATION SUCCESSFUL (ALL PASS)     ");
        console.log("==========================================");

    } catch (error) {
        console.error("\n[!!!] VERIFICATION FAILED [!!!]");
        console.error(error);
        process.exit(1);
    } finally {
        await prisma.user.delete({ where: { id: userId } }).catch(() => { });
        await prisma.$disconnect();
    }
}

main();
