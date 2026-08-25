import { prisma } from "../lib/prisma";
import { SubscriptionService } from "./subscriptionService";
import { mapFeatureKey } from "../billing/BillingGateway";
import logger from "../monitoring/logger";

/**
 * Entitlement Service — read-model cache layer.
 *
 * rebuildEntitlements recomputes the userEntitlement cache from the live
 * subscription + the immutable UsageEvent ledger. getEntitlements reads that
 * cache (with self-repair). All enforcement (hold/confirm/release) now lives
 * in BillingGateway; this service no longer consumes entitlements.
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
            // Default to calendar month for free tier. Built in UTC so the
            // window lines up with the UTC-stored confirmed_at timestamps —
            // same timezone fix as usageService.getCurrentUsage.
            const now = new Date();
            let periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
            let periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));

            if (subscription && ["active", "trialing", "on_trial", "past_due", "cancelled"].includes(subscription.status)) {
                // Double check entitlement expiry if present
                if (!subscription.entitlement_expires_at || new Date() < subscription.entitlement_expires_at) {
                    plan = subscription.plan;
                    if (subscription.current_period_start) periodStart = subscription.current_period_start;
                    if (subscription.current_period_end) periodEnd = subscription.current_period_end;

                    // 🔍 DIAGNOSTIC LOGGING
                    logger.info("Active subscription found during entitlement rebuild", {
                        userId,
                        rawPlan: subscription.plan,
                        normalizedPlan: plan,
                        status: subscription.status,
                        periodStart,
                        periodEnd
                    });
                }
            }

            // 2. Get Plan Constants (The Rules)
            const limits = SubscriptionService.getPlanLimits(plan) as Record<string, any>;

            // 🔍 DIAGNOSTIC LOGGING
            logger.info("Plan limits retrieved for entitlement build", {
                userId,
                plan,
                citation_audit_limit: limits.citation_audit,
                scans_per_month_limit: limits.scans_per_month,
                all_limits: JSON.stringify(limits)
            });

            // 3. Calculate Entitlements
            const features: Record<string, any> = {};

            // Pre-fetch all CONSUMED UsageEvent counts for this billing cycle,
            // grouped by feature. This is more efficient than one query per feature.
            const entitlementToGatewayFeature: Record<string, string> = {
                scans_per_month: "originality_scan",
                citation_audit: "citation_audit",
                rephrase_suggestions: "rephrase",
                originality_scan: "originality_scan",
                ai_chat: "ai_chat",
                ai_web_search: "ai_web_search",
                certificate: "certificate",
                paper_search: "paper_search",
                create_project: "create_project",
            };

            let consumedCounts: { feature: string; _count: number }[] = [];
            try {
                consumedCounts = await prisma.usageEvent.groupBy({
                    by: ["feature"],
                    where: {
                        user_id: userId,
                        status: "CONSUMED",
                        confirmed_at: { gte: periodStart },
                    },
                    _count: true,
                });
            } catch (e: any) {
                logger.warn("UsageEvent groupBy failed in rebuildEntitlements, falling back", {
                    userId, error: e.message,
                });
            }

            const usageByFeature: Record<string, number> = {};
            for (const row of consumedCounts) {
                usageByFeature[row.feature] = row._count;
            }

            // Also fetch legacy usageTracking counts for features that might
            // have pre-migration data but no UsageEvent entries yet.
            const legacyRecords = await prisma.usageTracking.findMany({
                where: {
                    user_id: userId,
                    period_start: { gte: periodStart },
                },
            });
            const legacyByFeature: Record<string, number> = {};
            for (const rec of legacyRecords) {
                legacyByFeature[rec.feature] = rec.count;
            }

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

                // Read usage from UsageEvent ledger (source of truth), falling
                // back to usageTracking for pre-migration data.
                const gatewayFeature = entitlementToGatewayFeature[feature] ?? feature;
                const used = usageByFeature[gatewayFeature] ?? legacyByFeature[feature] ?? 0;
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

    // NOTE: assertCanUse, consumeEntitlement, and checkEligibility were removed.
    // All enforcement now flows through BillingGateway (hold → execute →
    // confirm/release). rebuildEntitlements and getEntitlements remain as the
    // read-model cache layer.
}
