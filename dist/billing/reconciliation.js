"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReconciliationService = void 0;
const prisma_1 = require("../lib/prisma");
const EntitlementService_1 = require("../services/EntitlementService");
const subscriptionService_1 = require("../services/subscriptionService");
const BillingGateway_1 = require("./BillingGateway");
const logger_1 = __importDefault(require("../monitoring/logger"));
/**
 * Reconciliation Service — nightly alignment of the immutable UsageEvent
 * ledger with the read-model caches (userEntitlement, creditBalance).
 *
 * The UsageEvent table is the source of truth. After reconciliation,
 * userEntitlement.features.remaining will match what the ledger says was
 * consumed in the current billing cycle, and any HELD events older than a
 * configurable timeout are automatically released (preventing quota leaks
 * from crashed services that never confirmed/released).
 */
class ReconciliationService {
    /** How long a HELD event may sit before we consider it abandoned. */
    static HELD_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
    /**
     * Run full reconciliation for all active users.
     *
     * 1. Release stale HELD events (abandoned holds).
     * 2. For each user with activity this cycle, recompute usage from UsageEvent
     *    and compare with userEntitlement cache. Flag mismatches.
     * 3. Verify creditBalance matches sum of CREDIT UsageEvents.
     * 4. Rebuild entitlements for any user whose cache is stale.
     *
     * Returns a summary for monitoring dashboards.
     */
    static async runNightly() {
        logger_1.default.info("Starting nightly billing reconciliation");
        const result = {
            staleHeldReleased: 0,
            usersChecked: 0,
            entitlementMismatches: 0,
            creditMismatches: 0,
            entitlementsRebuilt: 0,
            errors: [],
        };
        try {
            // ── Phase A: Release abandoned HELD events ──
            result.staleHeldReleased = await this.releaseStaleHeldEvents();
            // ── Phase B: Verify entitlement caches ──
            const cutoff = new Date();
            cutoff.setDate(1); // start of current month
            cutoff.setHours(0, 0, 0, 0);
            // Find distinct users with CONSUMED UsageEvents this cycle.
            const activeUsers = await prisma_1.prisma.usageEvent.findMany({
                where: {
                    status: "CONSUMED",
                    confirmed_at: { gte: cutoff },
                },
                select: { user_id: true },
                distinct: ["user_id"],
            });
            for (const { user_id } of activeUsers) {
                try {
                    result.usersChecked++;
                    await this.reconcileUser(user_id, result);
                }
                catch (e) {
                    result.errors.push({ userId: user_id, error: e.message });
                    logger_1.default.error("Reconciliation failed for user", {
                        userId: user_id,
                        error: e.message,
                    });
                }
            }
            logger_1.default.info("Nightly billing reconciliation complete", {
                ...result,
                errors: result.errors.length,
            });
        }
        catch (e) {
            logger_1.default.error("Nightly reconciliation crashed", { error: e.message });
            result.errors.push({ userId: "SYSTEM", error: e.message });
        }
        return result;
    }
    /**
     * Release HELD events that have exceeded the timeout. This prevents quota
     * leaks when a service crashes after hold() but before confirm()/release().
     */
    static async releaseStaleHeldEvents() {
        const staleCutoff = new Date(Date.now() - this.HELD_TIMEOUT_MS);
        const staleEvents = await prisma_1.prisma.usageEvent.findMany({
            where: {
                status: "HELD",
                held_at: { lt: staleCutoff },
            },
            select: { id: true, user_id: true, source: true, cost: true, feature: true },
        });
        for (const event of staleEvents) {
            try {
                await prisma_1.prisma.$transaction(async (tx) => {
                    if (event.source === "CREDIT" && event.cost > 0) {
                        // Refund credit
                        await tx.creditTransaction.create({
                            data: {
                                user_id: event.user_id,
                                amount: event.cost,
                                type: "REFUND",
                                reference_id: event.id,
                                description: `Auto-released stale hold: ${event.feature}`,
                            },
                        });
                        await tx.creditBalance.update({
                            where: { user_id: event.user_id },
                            data: {
                                balance: { increment: event.cost },
                                lifetime_used: { decrement: event.cost },
                            },
                        });
                    }
                    else {
                        // Return one unit to the entitlement cache
                        const ent = await tx.userEntitlement.findUnique({
                            where: { user_id: event.user_id },
                        });
                        if (ent) {
                            const features = (ent.features ?? {});
                            const key = (0, BillingGateway_1.mapFeatureKey)(event.feature);
                            const rights = features[key];
                            if (rights && !rights.unlimited && typeof rights.remaining === "number") {
                                rights.remaining += 1;
                                if (typeof rights.used === "number" && rights.used > 0)
                                    rights.used -= 1;
                                features[key] = rights;
                                await tx.userEntitlement.update({
                                    where: { user_id: event.user_id },
                                    data: { features, last_updated: new Date() },
                                });
                            }
                        }
                    }
                    await tx.usageEvent.update({
                        where: { id: event.id },
                        data: {
                            status: "RELEASED",
                            released_at: new Date(),
                            error: "Auto-released: stale hold exceeded timeout",
                        },
                    });
                });
            }
            catch (e) {
                logger_1.default.error("Failed to release stale hold", {
                    eventId: event.id,
                    error: e.message,
                });
            }
        }
        if (staleEvents.length > 0) {
            logger_1.default.info("Released stale HELD events", { count: staleEvents.length });
        }
        return staleEvents.length;
    }
    /**
     * Reconcile a single user's entitlements and credits against the UsageEvent
     * ledger.
     */
    static async reconcileUser(userId, result) {
        const cutoff = new Date();
        cutoff.setDate(1);
        cutoff.setHours(0, 0, 0, 0);
        // ── Entitlement check ──
        const ent = await prisma_1.prisma.userEntitlement.findUnique({
            where: { user_id: userId },
        });
        if (!ent) {
            // No cache row — rebuild.
            await EntitlementService_1.EntitlementService.rebuildEntitlements(userId);
            result.entitlementsRebuilt++;
            return;
        }
        // Recompute consumed counts per feature from UsageEvent ledger.
        const consumed = await prisma_1.prisma.usageEvent.groupBy({
            by: ["feature"],
            where: {
                user_id: userId,
                status: "CONSUMED",
                confirmed_at: { gte: cutoff },
            },
            _count: true,
        });
        const consumedMap = {};
        for (const row of consumed) {
            consumedMap[row.feature] = row._count;
        }
        // Rebuild plan limits for comparison
        const plan = ent.plan || "free";
        const limits = subscriptionService_1.SubscriptionService.getPlanLimits(plan);
        const features = (ent.features ?? {});
        let needsRebuild = false;
        for (const [feature, count] of Object.entries(consumedMap)) {
            const key = (0, BillingGateway_1.mapFeatureKey)(feature);
            const rights = features[key];
            if (rights && typeof rights.used === "number") {
                // If the ledger says we consumed more than the cache records, flag it.
                if (rights.used !== count && !rights.unlimited) {
                    logger_1.default.warn("Entitlement usage mismatch detected", {
                        userId,
                        feature: key,
                        cachedUsed: rights.used,
                        ledgerUsed: count,
                    });
                    result.entitlementMismatches++;
                    needsRebuild = true;
                }
            }
        }
        if (needsRebuild) {
            await EntitlementService_1.EntitlementService.rebuildEntitlements(userId);
            result.entitlementsRebuilt++;
        }
        // ── Credit check ──
        const creditBalance = await prisma_1.prisma.creditBalance.findUnique({
            where: { user_id: userId },
        });
        if (creditBalance) {
            const sumCreditUsage = await prisma_1.prisma.usageEvent.aggregate({
                where: {
                    user_id: userId,
                    source: "CREDIT",
                    status: "CONSUMED",
                },
                _sum: { cost: true },
            });
            const ledgerTotal = sumCreditUsage._sum.cost ?? 0;
            // creditBalance.lifetime_used should match the sum of CREDIT UsageEvent costs
            if (creditBalance.lifetime_used !== ledgerTotal) {
                logger_1.default.warn("Credit balance mismatch detected", {
                    userId,
                    cachedLifetimeUsed: creditBalance.lifetime_used,
                    ledgerCreditTotal: ledgerTotal,
                });
                result.creditMismatches++;
                // Don't auto-correct credits — flag for manual review, as credit
                // balances may include purchases, refunds, and admin adjustments
                // that aren't all in UsageEvent.
            }
        }
    }
}
exports.ReconciliationService = ReconciliationService;
