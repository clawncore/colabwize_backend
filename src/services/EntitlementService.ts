import { prisma } from "../lib/prisma";
import { SubscriptionService } from "./subscriptionService"; // We will need constants from here, or move them
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
                last_updated: new Date()
            },
            update: {
                plan: plan,
                features: features,
                billing_cycle_start: periodStart,
                billing_cycle_end: periodEnd,
                last_updated: new Date()
            }
        });

        logger.info("Entitlements rebuilt", { userId, plan });
    }

    /**
     * Get entitlements (Cached/DB)
     */
    static async getEntitlements(userId: string) {
        let ent = await prisma.userEntitlement.findUnique({ where: { user_id: userId } });

        if (!ent) {
            await this.rebuildEntitlements(userId);
            ent = await prisma.userEntitlement.findUnique({ where: { user_id: userId } });
        }

        // Self-Repair: Check for stale billing cycle
        if (ent && new Date() > ent.billing_cycle_end) {
            logger.info("Entitlements expired (billing cycle), rebuilding", { userId });
            await this.rebuildEntitlements(userId);
            ent = await prisma.userEntitlement.findUnique({ where: { user_id: userId } });
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
        if (feature === 'citation_check') targetFeature = 'citation_audit';
        const rights = features[targetFeature];

        if (!rights) return { allowed: false };

        if (rights.unlimited) return { allowed: true, unlimited: true, remaining: -1 };

        const allowed = rights.remaining > 0;
        return { allowed, remaining: rights.remaining, unlimited: false };
    }
}
