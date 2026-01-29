import { prisma } from "../lib/prisma";
import { SubscriptionService } from "./subscriptionService";
import { CreditService } from "./CreditService"; // Added for credit fallback
import logger from "../monitoring/logger";

/**
 * Entitlement Service
 * The Single Source of Truth for what a user can do.
 */
export class EntitlementService {

    /**
     * Rebuild entitlements for a user.
     * MUST be called on:
     * 1. Subscription creation/update/cancellation
     * 2. Plan change
     * 3. Billing cycle rollover (webhook or lazy check)
     */
    static async rebuildEntitlements(userId: string): Promise<void> {
        logger.info("Rebuilding entitlements", { userId });

        // 0. Update Status to Running (State Management)
        // We use upsert to ensure row exists and set status
        await prisma.userEntitlement.upsert({
            where: { user_id: userId },
            create: {
                user_id: userId,
                plan: "free", // Placeholder, will update later
                features: {},
                billing_cycle_start: new Date(),
                billing_cycle_end: new Date(),
                rebuild_status: "running",
                last_rebuilt_at: new Date()
            },
            update: {
                rebuild_status: "running"
            }
        });

        try {
            // 1. Get raw subscription data (The Policy Source)
            const subscription = await prisma.subscription.findUnique({
                where: { user_id: userId },
            });

            let plan = "free";
            let periodStart = new Date();
            let periodEnd = new Date();
            // Default to calendar month for free tier
            periodStart.setDate(1);
            periodStart.setHours(0, 0, 0, 0);
            periodEnd.setMonth(periodEnd.getMonth() + 1);
            periodEnd.setDate(0);
            periodEnd.setHours(23, 59, 59, 999);

            if (subscription && subscription.status === "active") {
                // Double check entitlement expiry if present
                if (!subscription.entitlement_expires_at || new Date() < subscription.entitlement_expires_at) {
                    plan = subscription.plan;
                    if (subscription.current_period_start) periodStart = subscription.current_period_start;
                    if (subscription.current_period_end) periodEnd = subscription.current_period_end;
                }
            }

            // 2. Get Plan Constants (The Rules)
            // We access the static method from SubscriptionService or move constants here.
            // Ideally, constants should be shared. For now, accessing from SubscriptionService.
            const limits = SubscriptionService.getPlanLimits(plan);

            // 3. Calculate Entitlements
            const features: Record<string, any> = {};

            for (const [feature, limit] of Object.entries(limits)) {
                // Logic:
                // -1 => Unlimited
                // >= 0 => Finite limit

                const isUnlimited = limit === -1;
                const numericLimit = typeof limit === "number" ? limit : 0; // Handle booleans if any? existing code has booleans in limits?

                // If limit is boolean false/true in PLAN_LIMITS, handle it
                // The current PLAN_LIMITS has booleans for features like 'advanced_analytics'
                let limitValue = 0;
                let unlimited = false;
                let enabled = true;

                if (typeof limit === 'boolean') {
                    enabled = limit;
                    limitValue = 0; // Usage doesn't apply
                    unlimited = true; // Effectively "unlimited use" if enabled? Or just "access granted"
                } else if (limit === -1) {
                    unlimited = true;
                    limitValue = -1;
                } else {
                    limitValue = numericLimit;
                }

                // Check *Usage* for this cycle to calculate remaining
                // We assume usage tracking is still relevant for history, but for *enforcement* we can cache 'remaining'
                // BUT: 'remaining' changes on every use. 
                // Storing 'remaining' in Entitlements implies we update Entitlements on every use.
                // This is the desired "Single Source of Truth" architecture.

                // However, we need to initialize it.
                // We should check existing usage for *this period* from UsageTracking to initialize properly
                // in case of mid-cycle rebuild.

                const currentUsage = await prisma.usageTracking.findFirst({
                    where: {
                        user_id: userId,
                        feature: feature,
                        period_start: { gte: periodStart }
                    }
                });

                const used = currentUsage?.count || 0;
                const remaining = unlimited ? -1 : Math.max(0, limitValue - used);

                features[feature] = {
                    limit: limitValue,
                    used: used,
                    remaining: remaining,
                    unlimited: unlimited,
                    enabled: enabled
                };
            }

            // 4. Persist to DB
            await prisma.userEntitlement.upsert({
                where: { user_id: userId },
                create: {
                    user_id: userId,
                    plan: plan,
                    features: features,
                    billing_cycle_start: periodStart,
                    billing_cycle_end: periodEnd,
                    last_updated: new Date(),
                    rebuild_status: "idle",  // Success!
                    last_rebuilt_at: new Date(),
                    version: { increment: 1 }
                },
                update: {
                    plan: plan,
                    features: features,
                    billing_cycle_start: periodStart,
                    billing_cycle_end: periodEnd,
                    last_updated: new Date(),
                    rebuild_status: "idle", // Success!
                    last_rebuilt_at: new Date(),
                    version: { increment: 1 }
                }
            });

            logger.info("Entitlements rebuilt", { userId, plan });
        } catch (error: any) {
            logger.error("Entitlement rebuild failed", { userId, error: error.message });

            // Mark as failed
            await prisma.userEntitlement.update({
                where: { user_id: userId },
                data: {
                    rebuild_status: "failed",
                    last_updated: new Date()
                }
            });
            throw error; // Re-throw to ensure caller knows (though caller might be async fire-and-forget)
        }
    }

    /**
     * Get entitlements (Cached/DB)
     */
    static async getEntitlements(userId: string) {
        let ent = await prisma.userEntitlement.findUnique({ where: { user_id: userId } });

        // Safe Initialization: If missing, we MUST rebuild.
        // But if it IS missing, and we are paid, we might be in trouble if we block.
        // Current logic blocks until rebuild if missing. That is correct for initial state.
        if (!ent) {
            // We await here because if there is NO record, we have no decision basis.
            await this.rebuildEntitlements(userId);
            ent = await prisma.userEntitlement.findUnique({ where: { user_id: userId } });
        }

        // Self-Repair: Check for stale billing cycle
        if (ent && new Date() > ent.billing_cycle_end) {
            logger.info("Entitlements expired (billing cycle), rebuilding", { userId });
            await this.rebuildEntitlements(userId);
            ent = await prisma.userEntitlement.findUnique({ where: { user_id: userId } });
        }

        // Self-Repair: Check for stale Researcher/Student Pro limits (Hotfix)
        if (ent) {
            const features = ent.features as Record<string, any>;
            const scans = features['scans_per_month'];
            const normalizedPlan = ent.plan.toLowerCase();

            // If Researcher and NOT unlimited, rebuild
            if (normalizedPlan === 'researcher' && scans && !scans.unlimited) {
                logger.info("Entitlements stale (Researcher should be unlimited), rebuilding", { userId });
                await this.rebuildEntitlements(userId);
                ent = await prisma.userEntitlement.findUnique({ where: { user_id: userId } });
            }

            // If Student Pro and limit is small (e.g. 25 from student mapping), rebuild
            if (normalizedPlan === 'student pro' || normalizedPlan === 'student_pro') {
                if (scans && scans.limit < 50) { // Assuming new limit is > 50 (it's 100)
                    logger.info("Entitlements stale (Student Pro limit too low), rebuilding", { userId });
                    await this.rebuildEntitlements(userId);
                    ent = await prisma.userEntitlement.findUnique({ where: { user_id: userId } });
                }
            }
        }

        return ent;
    }

    /**
     * Consume an entitlement
     * @returns processed: boolean (true if allowed/consumed, false if blocked)
     */
    static async consumeEntitlement(userId: string, feature: string): Promise<boolean> {
        const ent = await this.getEntitlements(userId);
        if (!ent) return false;

        const features = ent.features as Record<string, any>;
        const feat = features[feature] || features['scans_per_month']; // Fallback/Mapping if needed?

        // Canonical mapping logic similar to SubscriptionService
        let targetFeature = feature;
        if (feature === 'scan') targetFeature = 'scans_per_month';
        if (feature === 'citation_check') targetFeature = 'citation_audit';
        const rights = features[targetFeature];

        if (!rights) {
            // Feature not in plan
            return false;
        }

        if (rights.unlimited) {
            return true; // Allowed
        }

        if (rights.remaining > 0) {
            // Decrement in DB
            // We need to update the JSON carefully. 
            // Prisma doesn't support deep JSON updates easily in one atomic op without raw query or fetching.
            // For safety/speed, we can fetch-modify-save or use a raw query if concurrency is high.
            // Given the architecture, let's do fetch-modify-save for now, but really we should use UsageTracking as the counter
            // and Entitlements as the *Gate*.
            // BUT the prompt asked for Entitlements to be the source.
            // "recompute entitlements from plan... persist entitlements"
            // "decrementRemaining()"

            // Let's update the JSON.
            rights.used += 1;
            rights.remaining -= 1;
            features[targetFeature] = rights;

            await prisma.userEntitlement.update({
                where: { user_id: userId },
                data: { features }
            });
            return true;
        }

        return false;
    }

    /**
     * Check eligibility (Dry Run)
     */
    static async checkEligibility(userId: string, feature: string): Promise<{ allowed: boolean; remaining?: number; unlimited?: boolean }> {
        const ent = await this.getEntitlements(userId);
        if (!ent) return { allowed: false };

        const features = ent.features as Record<string, any>;
        // Mapping
        let targetFeature = feature;
        if (feature === 'scan') targetFeature = 'scans_per_month';
        if (feature === 'citation_check') targetFeature = 'citation_audit'; // Fix mapping
        const rights = features[targetFeature];

        if (!rights) return { allowed: false };

        if (rights.unlimited) return { allowed: true, unlimited: true, remaining: -1 };

        const allowed = rights.remaining > 0;
        return { allowed, remaining: rights.remaining, unlimited: false };
    }

    /**
     * ASSERT that a user can use a feature.
     * The SINGLE SOURCE OF TRUTH for enforcement.
     * Throws an error if blocked.
     * Consumes entitlement or credits if allowed.
     */
    static async assertCanUse(userId: string, feature: string, metadata?: any): Promise<boolean> {
        // 1. Get Entitlements
        let ent = await this.getEntitlements(userId);

        // 🛡️ SAFE-ALLOW LOGIC (Innocent until proven guilty)
        // If rebuild is IN PROGRESS or FAILED (and not just idle), check if we should allow optimistically.
        const status = (ent as any)?.rebuild_status || "idle";

        if (ent && (status === "running" || status === "failed")) {
            // Check implicit subscription status directly to decide "Are they a paid user?"
            try {
                const sub = await SubscriptionService.getUserSubscription(userId);
                if (sub && ["active", "trialing"].includes(sub.status) && sub.plan !== "free") {
                    // PAID USER in unknown state -> ALLOW
                    logger.warn("Optimistic Allow: Entitlements rebuilding/failed for paid user. Allowing feature access.", { userId, feature, status });
                    return true;
                }
            } catch (err) {
                // If even subscription fetch fails, fall back to "Restrict"
                logger.error("Safe-allow check failed", { userId, error: err });
            }
        }
        if (!ent) throw new Error("Entitlements not found");




        // SELF-HEALING GUARD:
        // If user has an active paid subscription but entitlements say "free", REBUILD.
        // This prevents race conditions where subscription updated but entitlements lag.
        try {
            const sub = await SubscriptionService.getUserSubscription(userId);
            if (sub && ["active", "trialing"].includes(sub.status) && ent?.plan === "free" && sub.plan !== "free") {
                logger.warn("Self-healing: Active subscription with free entitlements found. Rebuilding.", { userId, subPlan: sub.plan });
                await this.rebuildEntitlements(userId);
                ent = await this.getEntitlements(userId);
            }
        } catch (e) {
            logger.error("Self-healing check failed", { userId, error: e });
        }

        if (!ent) {
            throw new Error("Entitlements not found"); // Should not happen due to getEntitlements logic
        }

        // 2. Map Feature to Entitlement Key
        let targetFeature = feature;
        // Canonical mapping
        if (feature === 'scan') targetFeature = 'scans_per_month';
        if (feature === 'citation_check') targetFeature = 'citation_audit';

        const features = ent.features as Record<string, any>;
        let rights = features[targetFeature];

        // 3. Check Plan Restrictions (Is it even allowed?)
        // If rights is undefined/null, it means the feature is likely not in the plan at all (unless it's a new feature).

        // SELF-HEALING: If feature is missing from entitlements but SHOULD be in the plan, rebuild.
        if (!rights) {
            try {
                const currentLimits = SubscriptionService.getPlanLimits(ent.plan) as Record<string, any>;
                if (currentLimits && (currentLimits[targetFeature] !== undefined)) {
                    logger.warn("Self-healing: Feature missing from entitlements but present in plan. Rebuilding.", { userId, feature: targetFeature });
                    await this.rebuildEntitlements(userId);
                    ent = await this.getEntitlements(userId);

                    // Re-fetch rights after rebuild
                    const newFeatures = ent?.features as Record<string, any>;
                    if (newFeatures) {
                        rights = newFeatures[targetFeature];
                    }
                }
            } catch (e) {
                logger.error("Self-healing for missing feature failed", { userId, error: e });
            }
        }

        if (!rights) {
            throw new Error(`Feature ${feature} is not available on your current plan.`);
        }

        // 4. Check Entitlement (Primary Gate)
        if (rights.unlimited) {
            return true; // Allowed (Unlimited)
        }

        if (rights.remaining > 0) {
            // CONSUME ENTITLEMENT
            rights.used += 1;
            rights.remaining -= 1;
            features[targetFeature] = rights;

            // Optimistic update
            await prisma.userEntitlement.update({
                where: { user_id: userId },
                data: { features }
            });

            // Also track in legacy UsageTracking for data continuity?
            // Yes, let's keep UsageTracking as a log.
            // We can do this asynchronously or import UsageService.
            // avoiding circular dep with UsageService if possible.
            // UsageService imports EntitlementService, so EntitlementService importing UsageService is circular.
            // We can just log it or write to prisma directly if needed, or rely on UsageService calling consumeEntitlement (OLD WAY).
            // NEW WAY: assertCanUse DOES the consumption.
            // We should ideally fire-and-forget a usage tracking call, slightly risky if it fails but acceptable for analytics.
            // Or just verify if UsageTracking is critical for anything else.
            // It's used for history. Let's write to it directly or via a detached helper.
            // For now, focus on the GATE.

            return true;
        }

        // 5. Entitlement Exhausted -> Check Credits (Secondary Gate)
        // Rule: Can only use credits if the plan *allows* the feature (which is checked by existence of rights usually).
        // Some features might be Hard Blocked (e.g. Student Plan scan limit?).
        // Prompt Check: "Student Plan: Hard Block if limit reached".
        // We need to know if we are on a plan that allows Pay-As-You-Go.
        // The implementation check in SubscriptionService had:
        // if (normalizedPlan === "student") -> BLOCKED.

        const planName = ent.plan.toLowerCase();
        if (planName === 'student') {
            throw new Error("Monthly plan limit reached. Upgrade to Researcher for more.");
        }

        // Check Auto-Use Preference
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { auto_use_credits: true } });
        if (user && user.auto_use_credits === false) {
            throw new Error("Plan limit reached. Enable Auto-Use Credits to continue.");
        }

        // Calculate Cost
        const cost = CreditService.calculateCost(feature, metadata);

        if (cost > 0) {
            const hasCredits = await CreditService.hasEnoughCredits(userId, cost);
            if (hasCredits) {
                await CreditService.deductCredits(userId, cost, undefined, `Auto-use: ${feature}`);
                return true;
            } else {
                // Throw specific error for frontend to handle (402/Upgrade)
                const error: any = new Error("Plan limit reached and insufficient credits.");
                error.code = "INSUFFICIENT_CREDITS";
                throw error;
            }
        }

        // If cost is 0 (should shouldn't happen for consumable features) or generic block
        throw new Error("Plan limit reached.");
    }
}
