
import { PrismaClient } from "@prisma/client";
import { EntitlementService } from "../src/services/EntitlementService";
import { SubscriptionService } from "../src/services/subscriptionService";
import { CreditService } from "../src/services/CreditService";

const prisma = new PrismaClient();
const USER_ID = "1e3cfeb7-c3b2-4579-983a-3d031cabb8d1";

async function main() {
    console.log(`Checking user: ${USER_ID}`);

    // 1. Subscription
    const sub = await SubscriptionService.getUserSubscription(USER_ID);
    console.log("Subscription:", sub);

    // 2. Plan
    const plan = await SubscriptionService.getActivePlan(USER_ID);
    console.log("Active Plan:", plan);

    // 3. Entitlements
    const ent = await EntitlementService.getEntitlements(USER_ID);
    console.log("Entitlements Plan:", ent?.plan);
    if (ent && ent.features) {
        const f = ent.features as any;
        console.log("citation_audit usage:", f.citation_audit);
    }

    // 4. Credits
    const credits = await CreditService.getBalance(USER_ID);
    console.log("Credit Balance:", credits);

    // 5. Check Eligibility
    try {
        const check = await EntitlementService.checkEligibility(USER_ID, "citation_check");
        console.log("Entitlement Check (citation_check):", check);
    } catch (e: any) {
        console.log("Entitlement Check Failed:", e.message);
    }

    // 6. Assert Test
    try {
        await EntitlementService.assertCanUse(USER_ID, "citation_check");
        console.log("AssertCanUse: SUCCESS");
    } catch (e: any) {
        console.log("AssertCanUse: FAILED -", e.message);
        console.log("Error Code:", e.code);
    }
}

main()
    .catch((e) => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
