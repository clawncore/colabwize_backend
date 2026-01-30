import { prisma } from "../lib/prisma";
import { SubscriptionService } from "./subscriptionService";
import { CreditService } from "./CreditService";
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
            const limits = SubscriptionService.getPlanLimits(plan) as Record<string, any>;

            // 3. Calculate Entitlements
            const features: Record<string, any> = {};

            for (const [feature, limit] of Object.entries(limits)) {
                // Logic:
                // -1 => Unlimited
                // >= 0 => Finite limit

                const numericLimit = typeof limit === "number" ? limit : 0;

                let limitValue = 0;
                let unlimited = false;
                let enabled = true;

                if (typeof limit === 'boolean') {
                    enabled = limit;
                    limitValue = 0; // Usage doesn't apply
                    unlimited = true; // Effectively "unlimited use" if enabled
                } else if (limit === -1) {
                    unlimited = true;
                    limitValue = -1;
                } else {
                    limitValue = numericLimit;
                }

                // Check *Usage* for this cycle to calculate remaining
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
                    version: 1
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
            throw error;
        }
    }

    /**
     * Get entitlements (Cached/DB)
     */
    static async getEntitlements(userId: string) {
        let ent = await prisma.userEntitlement.findUnique({ where: { user_id: userId } });

        // Safe Initialization: If missing, we MUST rebuild.
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

        // Generic Self-Repair: Validate that specific critical limits match the configuration.
        // This avoids hardcoding checks like "if student pro and limit < 50".
        if (ent) {
            try {
                const currentPlanLimits = SubscriptionService.getPlanLimits(ent.plan) as Record<string, any>;
                const storedFeatures = ent.features as Record<string, any>;

                // We check a few key features to ensure version consistency
                const featuresToCheck = ['scans_per_month', 'originality_scan', 'citation_audit'];
                let needsRebuild = false;

                for (const feature of featuresToCheck) {
                    const stored = storedFeatures[feature];
                    const expected = currentPlanLimits[feature];

                    if (stored && expected !== undefined) {
                        // Normalize expected limit
                        let expectedLimit = typeof expected === 'number' ? expected : 0;
                        if (expected === -1) expectedLimit = -1;

                        // Check for mismatch (only if stored is not undefined)
                        // A stored limit of -1 (unlimited) should match expected -1
                        if (stored.limit !== expectedLimit) {
                            logger.warn(`Entitlement limit mismatch for ${feature}. Stored: ${stored.limit}, Expected: ${expectedLimit}. Rebuilding.`, { userId, plan: ent.plan });
                            needsRebuild = true;
                            break;
                        }
                    }
                }

                if (needsRebuild) {
                    await this.rebuildEntitlements(userId);
                    ent = await prisma.userEntitlement.findUnique({ where: { user_id: userId } });
                }

            } catch (err) {
                logger.error("Error validating entitlement consistency", { userId, error: err });
            }
        }

        return ent;
    }

    /**
     * Consume an entitlement
     */
    static async consumeEntitlement(userId: string, feature: string): Promise<boolean> {
        const ent = await this.getEntitlements(userId);
        if (!ent) return false;

        const features = ent.features as Record<string, any>;

        // Canonical mapping logic
        let targetFeature = feature;
        if (feature === 'scan') targetFeature = 'scans_per_month';
        if (feature === 'citation_check') targetFeature = 'citation_audit'; // Legacy mapping
        if (feature === 'rephrase') targetFeature = 'rephrase_suggestions';
        if (feature === 'originality') targetFeature = 'originality_scan';
        if (feature === 'chat') targetFeature = 'ai_chat';
        // 'ai_integrity', 'paper_search', 'originality_scan' usually passed directly, so they work by default.

        const rights = features[targetFeature];

        if (!rights) return false;

        if (rights.unlimited) return true;

        if (rights.remaining > 0) {
            // Decrement in DB
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
        let targetFeature = feature;
        if (feature === 'scan') targetFeature = 'scans_per_month';
        if (feature === 'citation_check') targetFeature = 'citation_audit';

        const rights = features[targetFeature];

        if (!rights) return { allowed: false };

        if (rights.unlimited) return { allowed: true, unlimited: true, remaining: -1 };

        const allowed = rights.remaining > 0;
        return { allowed, remaining: rights.remaining, unlimited: false };
    }

    /**
     * ASSERT that a user can use a feature.
     * The SINGLE SOURCE OF TRUTH for enforcement.
     */
    static async assertCanUse(userId: string, feature: string, metadata?: any): Promise<boolean> {
        // 1. Get Entitlements
        let ent = await this.getEntitlements(userId);

        // 🛡️ SAFE-ALLOW LOGIC (Innocent until proven guilty)
        const status = (ent as any)?.rebuild_status || "idle";

        if (ent && (status === "running" || status === "failed")) {
            try {
                const sub = await SubscriptionService.getUserSubscription(userId);
                if (sub && ["active", "trialing"].includes(sub.status) && sub.plan !== "free") {
                    logger.warn("Optimistic Allow: Entitlements rebuilding/failed for paid user.", { userId, feature });
                    return true;
                }
            } catch (err) {
                logger.error("Safe-allow check failed", { userId, error: err });
            }
        }
        if (!ent) throw new Error("Entitlements not found");

        // SELF-HEALING: If user has an active paid subscription but entitlements say "free"
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

        if (!ent) throw new Error("Entitlements not found");

        // 2. Map Feature to Entitlement Key
        let targetFeature = feature;
        if (feature === 'scan') targetFeature = 'scans_per_month';
        if (feature === 'citation_check') targetFeature = 'citation_audit';

        const features = ent.features as Record<string, any>;
        let rights = features[targetFeature];

        // 3. Double Check against Plan Definition (Generic Logic)
        // If feature is missing but SHOULD be there, or if limits differ
        if (!rights || (rights && !rights.unlimited)) {
            try {
                const currentLimits = SubscriptionService.getPlanLimits(ent.plan) as Record<string, any>;
                const planLimit = currentLimits[targetFeature];

                // Mismatch Check
                if (planLimit !== undefined) {
                    let expectedLimit = typeof planLimit === 'number' ? planLimit : 0;
                    if (planLimit === -1) expectedLimit = -1;

                    const storedLimit = rights ? rights.limit : undefined;

                    if (storedLimit !== expectedLimit) {
                        logger.warn("Self-healing: Entitlement limit mismatch found during assertion. Rebuilding.", {
                            userId,
                            plan: ent.plan,
                            feature: targetFeature,
                            expected: expectedLimit,
                            stored: storedLimit
                        });
                        await this.rebuildEntitlements(userId);
                        ent = await this.getEntitlements(userId);
                        if (ent) {
                            const newFeatures = ent.features as Record<string, any>;
                            rights = newFeatures[targetFeature];
                        }
                    }
                }
            } catch (e) {
                logger.error("Self-healing validation failed", { userId, error: e });
            }
        }

        if (!rights) {
            throw new Error(`Feature ${feature} is not available on your current plan.`);
        }

        // 4. Check Entitlement (Primary Gate)
        if (rights.unlimited) {
            return true;
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

            return true;
        }

        // 5. Entitlement Exhausted -> Check Credits (Secondary Gate)
        // Student Plan: Hard Block if limit reached (Legacy Rule kept for now, or assume credits allowed if plan allows?)
        // The user complained about "limit reached" confusingly. 
        // If "payg" is allowed, we check credits.
        // We will stick to the existing rule: If plan is "student", hard block. 
        // Student Plan: Credit Failover Enabled
        // We previously blocked student plan here, but now we allow failover provided they have credits.


        const user = await prisma.user.findUnique({ where: { id: userId }, select: { auto_use_credits: true } });
        if (user && user.auto_use_credits === false) {
            throw new Error("Plan limit reached. Enable Auto-Use Credits to continue.");
        }

        const cost = CreditService.calculateCost(feature, metadata);

        if (cost > 0) {
            const hasCredits = await CreditService.hasEnoughCredits(userId, cost);
            if (hasCredits) {
                await CreditService.deductCredits(userId, cost, undefined, `Auto-use: ${feature}`);
                return true;
            } else {
                const error: any = new Error("Plan limit reached and insufficient credits.");
                error.code = "INSUFFICIENT_CREDITS";
                throw error;
            }
        }

        throw new Error("Plan limit reached.");
    }
}
