"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BillingGateway = exports.BillingError = void 0;
exports.mapFeatureKey = mapFeatureKey;
const prisma_1 = require("../lib/prisma");
const logger_1 = __importDefault(require("../monitoring/logger"));
const subscriptionService_1 = require("../services/subscriptionService");
const CreditService_1 = require("../services/CreditService");
class BillingError extends Error {
    code;
    data;
    constructor(code, message, data) {
        super(message);
        this.name = "BillingError";
        this.code = code;
        this.data = data;
    }
}
exports.BillingError = BillingError;
class BillingGateway {
    /**
     * Reserve (hold) one unit of a feature for the user.
     *
     * If the user has plan quota, the entitlement cache is decremented
     * atomically (conditional UPDATE guarded by `version`) and a HELD
     * UsageEvent is written. If plan quota is exhausted, credits are deducted
     * instead. If neither is available a BillingError is thrown and NO hold is
     * written.
     *
     * Idempotent: when referenceId is supplied and a HELD/CONSUMED event already
     * exists for it, that existing event is returned instead of creating a new
     * hold. This makes retries and double-clicks safe.
     */
    static async hold(userId, feature, metadata) {
        const referenceId = metadata?.referenceId ?? null;
        // Idempotency short-circuit: a prior hold for this key already exists.
        if (referenceId) {
            let existing;
            try {
                existing = await prisma_1.prisma.usageEvent.findFirst({
                    where: { reference_id: referenceId },
                });
            }
            catch (e) {
                // usage_events table may not exist yet (migration pending). Log and
                // fall through to create a new hold — the transaction below will also
                // fail, and the error will surface clearly.
                logger_1.default.error("UsageEvent table query failed — migration may be pending", {
                    error: e.message,
                });
            }
            if (existing && (existing.status === "HELD" || existing.status === "CONSUMED")) {
                return {
                    eventId: existing.id,
                    source: existing.source,
                    cost: existing.cost,
                    remaining: -1,
                };
            }
        }
        const result = await prisma_1.prisma.$transaction(async (tx) => {
            // Ensure an entitlement row exists so the conditional update has a row.
            let ent = await tx.userEntitlement.findUnique({ where: { user_id: userId } });
            if (!ent) {
                // Lazy-initialize entitlements (mirrors EntitlementService safe-init).
                await tx.userEntitlement.create({
                    data: {
                        user_id: userId,
                        plan: "free",
                        features: {},
                        billing_cycle_start: new Date(),
                        billing_cycle_end: new Date(),
                        rebuild_status: "idle",
                        last_rebuilt_at: new Date(),
                        version: 1,
                    },
                });
                ent = await tx.userEntitlement.findUnique({ where: { user_id: userId } });
            }
            if (!ent)
                throw new BillingError("ENTITLEMENT_ERROR", "Entitlements not found");
            // Map the route-level feature name to the entitlement key.
            const targetFeature = mapFeatureKey(feature);
            // Read fresh live truth for this feature. We deliberately do NOT trust a
            // possibly-stale `remaining` value across retries: concurrent holds share
            // one userEntitlement row, so a value read at the top of the transaction
            // is the latest committed state and is re-checked by the version guard on
            // every attempt.
            const resolveRights = async () => {
                const plan = await getPlanForEntitlement(tx, userId);
                const limits = subscriptionService_1.SubscriptionService.getPlanLimits(plan);
                const limit = limits[targetFeature];
                let limitValue = 0;
                let unlimited = false;
                let enabled = true;
                if (typeof limit === "boolean") {
                    enabled = limit;
                    unlimited = true;
                }
                else if (limit === -1) {
                    unlimited = true;
                    limitValue = -1;
                }
                else if (typeof limit === "number") {
                    limitValue = limit;
                    enabled = limit !== 0 || ["scan", "rephrase", "citation_audit", "paper_search"].includes(feature);
                }
                const latest = await tx.userEntitlement.findUnique({ where: { user_id: userId } });
                if (!latest)
                    throw new BillingError("ENTITLEMENT_ERROR", "Entitlements not found");
                ent = latest;
                const features = (ent.features ?? {});
                // Only recompute from the UsageEvent ledger when the cache looks stale
                // (missing, or remaining isn't a number). Otherwise trust the cached
                // used/remaining — it's the most recent committed view and the version
                // guard below makes the decrement atomic.
                let rights = features[targetFeature];
                if (!rights || (!rights.unlimited && typeof rights.remaining !== "number")) {
                    const currentUsage = await tx.usageEvent.count({
                        where: {
                            user_id: userId,
                            feature, // gateway feature name, not entitlement key
                            status: "CONSUMED",
                            confirmed_at: { gte: ent.billing_cycle_start },
                        },
                    });
                    const used = currentUsage;
                    const remaining = unlimited ? -1 : Math.max(0, limitValue - used);
                    rights = { limit: limitValue, used, remaining, unlimited, enabled };
                    features[targetFeature] = rights;
                }
                return { features, rights };
            };
            // ---- Attempt PLAN consumption, retrying on lost version races ----
            // Concurrent holds on the same user race on the single entitlement row's
            // version. The loser of a race would otherwise fall through to a hard
            // block; instead we re-read the fresh state and retry a bounded number of
            // times. This keeps the gate correct under concurrency (no double-spend)
            // without falsely rejecting a request that has quota.
            const MAX_HOLD_RETRIES = 5;
            for (let attempt = 0; attempt <= MAX_HOLD_RETRIES; attempt++) {
                const { features, rights } = await resolveRights();
                if (rights && (rights.unlimited || rights.remaining > 0)) {
                    if (rights.unlimited) {
                        const event = await tx.usageEvent.create({
                            data: {
                                user_id: userId,
                                feature,
                                source: "PLAN",
                                cost: 0,
                                status: "HELD",
                                reference_id: referenceId,
                                metadata: metadata ? safeMetadata(metadata) : undefined,
                                held_at: new Date(),
                            },
                        });
                        return { event, source: "PLAN", cost: 0, remaining: -1 };
                    }
                    // Conditional decrement guarded by version. If another transaction
                    // committed a version bump first, zero rows match and we loop to
                    // re-read rather than falling through to a hard block.
                    const newUsed = (rights.used ?? 0) + 1;
                    const newRemaining = Math.max(0, rights.remaining - 1);
                    features[targetFeature] = {
                        ...rights,
                        used: newUsed,
                        remaining: newRemaining,
                    };
                    const updated = await tx.userEntitlement.updateMany({
                        where: { user_id: userId, version: ent.version },
                        data: {
                            features,
                            version: { increment: 1 },
                            last_updated: new Date(),
                        },
                    });
                    if (updated.count === 1) {
                        const event = await tx.usageEvent.create({
                            data: {
                                user_id: userId,
                                feature,
                                source: "PLAN",
                                cost: 0,
                                status: "HELD",
                                reference_id: referenceId,
                                metadata: metadata ? safeMetadata(metadata) : undefined,
                                held_at: new Date(),
                            },
                        });
                        return {
                            event,
                            source: "PLAN",
                            cost: 0,
                            remaining: newRemaining,
                        };
                    }
                    // Lost the version race — loop and retry with fresh state.
                    continue;
                }
                // rights missing or remaining <= 0: don't retry, surface hard block below.
                break;
            }
            // ---- Plan exhausted (or feature not on plan): overflow to credits ----
            // The plan path is spent. Two distinct things can happen here:
            //   (a) the feature isn't on this plan at all → hard block with upgrade
            //   (b) the feature IS on this plan but monthly quota is exhausted →
            //       automatically overflow to the credit wallet (if the user opted
            //       in via auto_use_credits), otherwise prompt to upgrade/buy credits.
            const plan = await getPlanForEntitlement(tx, userId);
            // Feature availability check: is this feature enabled on the user's plan
            // at all? We recompute live rights (not the stale `rights` from the plan
            // loop above) so a newly-active subscription is respected.
            const availability = await computeAvailability(tx, userId, feature);
            if (!availability.available) {
                throw new BillingError("PLAN_LIMIT_REACHED", `This feature is not available on your current plan.`, { feature, plan, upgrade_url: "/pricing" });
            }
            // Feature is on the plan but monthly quota is exhausted. Fall back to
            // credits when the user has opted in.
            const autoUse = await tx.user.findUnique({
                where: { id: userId },
                select: { auto_use_credits: true },
            });
            const cost = (0, CreditService_1.calculateCost)(feature, metadata);
            if (autoUse?.auto_use_credits === false) {
                // User opted out of auto-credit usage: treat exhaustion as a hard block
                // that offers the manual "buy credits" path.
                throw new BillingError("INSUFFICIENT_CREDITS", `You've reached your ${plan} plan limit for ${feature}. Enable auto-use credits, or buy credits to continue.`, { feature, plan, upgrade_url: "/pricing", buy_credits_url: "/dashboard/credits" });
            }
            // Attempt to reserve credits for the overflow unit.
            let reservationId;
            try {
                reservationId = await CreditService_1.CreditService.reserveCredits(userId, cost, referenceId ?? undefined);
            }
            catch (e) {
                // Not enough credits (or reservation failed). Surface a 402-ish error
                // telling the user to top up.
                const balance = await CreditService_1.CreditService.getBalance(userId);
                throw new BillingError("INSUFFICIENT_CREDITS", `You've reached your plan limit and don't have enough credits to run ${feature}. Buy more credits to continue.`, {
                    feature,
                    plan,
                    cost,
                    balance,
                    upgrade_url: "/pricing",
                    buy_credits_url: "/dashboard/credits",
                });
            }
            // Credit reserved. Write the HELD UsageEvent as a CREDIT-sourced hold so
            // that release() refunds the reservation.
            const event = await tx.usageEvent.create({
                data: {
                    user_id: userId,
                    feature,
                    source: "CREDIT",
                    cost,
                    status: "HELD",
                    reference_id: referenceId,
                    metadata: metadata ? safeMetadata(metadata) : undefined,
                    held_at: new Date(),
                },
            });
            return {
                event,
                source: "CREDIT",
                cost,
                remaining: -1,
            };
        });
        logger_1.default.info("Billing hold acquired", {
            userId,
            feature,
            source: result.source,
            cost: result.cost,
            eventId: result.event.id,
        });
        return {
            eventId: result.event.id,
            source: result.source,
            cost: result.cost,
            remaining: result.remaining,
        };
    }
    /**
     * Confirm a held event after successful feature execution. Marks the
     * UsageEvent CONSUMED so it counts as final usage.
     */
    static async confirm(eventId, metadata) {
        try {
            const event = await prisma_1.prisma.usageEvent.update({
                where: { id: eventId },
                data: {
                    status: "CONSUMED",
                    confirmed_at: new Date(),
                    metadata: metadata ? prismaJsonMerge(metadata) : undefined,
                },
            });
            // Keep the legacy usageTracking table in sync so that any code still
            // reading from it (analytics, fallback queries) sees current data.
            // This is fire-and-forget; failure must not block the confirm path.
            const { UsageService } = await import("../services/usageService.js");
            UsageService.trackUsage(event.user_id, event.feature).catch(() => { });
        }
        catch (e) {
            // confirm() must never throw into the request path — the feature already
            // ran. Log loudly for manual reconciliation.
            logger_1.default.error("Billing confirm failed", { eventId, error: e.message });
        }
    }
    /**
     * Release a held event when feature execution fails. Returns the held unit
     * to the entitlement cache (PLAN) or refunds the credit (CREDIT) so the user
     * is only ever charged for work that completed.
     */
    static async release(eventId, reason) {
        try {
            const event = await prisma_1.prisma.usageEvent.findUnique({ where: { id: eventId } });
            if (!event || event.status !== "HELD")
                return;
            await prisma_1.prisma.$transaction(async (tx) => {
                if (event.source === "CREDIT" && event.cost > 0) {
                    // Refund the credit.
                    await tx.creditTransaction.create({
                        data: {
                            user_id: event.user_id,
                            amount: event.cost,
                            type: "REFUND",
                            reference_id: event.id,
                            description: `Released hold: ${reason ?? event.feature}`,
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
                    // Refund one unit into the entitlement cache for the plan path.
                    const ent = await tx.userEntitlement.findUnique({ where: { user_id: event.user_id } });
                    const features = (ent?.features ?? {});
                    const targetFeature = mapFeatureKey(event.feature);
                    const rights = features[targetFeature];
                    if (rights && !rights.unlimited && typeof rights.remaining === "number") {
                        rights.remaining += 1;
                        if (typeof rights.used === "number" && rights.used > 0)
                            rights.used -= 1;
                        features[targetFeature] = rights;
                        await tx.userEntitlement.update({
                            where: { user_id: event.user_id },
                            data: { features, last_updated: new Date() },
                        });
                    }
                }
                await tx.usageEvent.update({
                    where: { id: eventId },
                    data: {
                        status: "RELEASED",
                        released_at: new Date(),
                        error: reason ?? null,
                    },
                });
            });
            logger_1.default.info("Billing hold released", { eventId, source: event.source, cost: event.cost, reason });
        }
        catch (e) {
            logger_1.default.error("Billing release failed", { eventId, error: e.message });
        }
    }
    /**
     * Convenience: run a feature through the full lifecycle in one call.
     *
     *   hold → execute → confirm (on success)
     *                  → release (on any throw)
     *
     * `metadata.referenceId` is strongly recommended so the gate is idempotent
     * across client retries and double-clicks.
     */
    static async withFeature(userId, feature, metadata, execute) {
        const hold = await this.hold(userId, feature, metadata);
        try {
            const result = await execute();
            await this.confirm(hold.eventId);
            return result;
        }
        catch (e) {
            await this.release(hold.eventId, e?.message);
            throw e;
        }
    }
}
exports.BillingGateway = BillingGateway;
// ---- helpers ----
function mapFeatureKey(feature) {
    const map = {
        scan: "scans_per_month",
        // ── Originality billing disabled per request (code preserved) ──
        // originality_scan: "scans_per_month",
        citation_audit: "citation_audit",
        citation_check: "citation_audit",
        rephrase: "rephrase_suggestions",
        // originality: "originality_scan",
        chat: "ai_chat",
        ai_chat: "ai_chat",
        ai_web_search: "ai_web_search",
        paper_search: "paper_search",
        certificate: "certificate",
        create_project: "create_project",
        publish_export: "publish_export",
    };
    return map[feature] ?? feature;
}
async function getPlanForEntitlement(tx, userId) {
    const sub = await tx.subscription.findUnique({ where: { user_id: userId } });
    if (!sub)
        return "free";
    if (sub.entitlement_expires_at && new Date() > sub.entitlement_expires_at)
        return "free";
    if (!["active", "trialing", "on_trial", "past_due", "cancelled"].includes(sub.status)) {
        return "free";
    }
    return sub.plan;
}
/**
 * Determine whether a feature is available on the user's current plan at all
 * (regardless of remaining quota). Returns `{ available, plan }`. A feature is
 * "available" when the plan limit is a non-zero number, -1 (unlimited), or a
 * boolean true. A limit of 0 (or false) means the feature is plan-restricted —
 * except for a few core features that are always allowed on every plan.
 */
async function computeAvailability(tx, userId, feature) {
    const plan = await getPlanForEntitlement(tx, userId);
    const limits = subscriptionService_1.SubscriptionService.getPlanLimits(plan);
    const targetFeature = mapFeatureKey(feature);
    const limit = limits[targetFeature];
    // Core features are always available on every plan (they overflow to credits
    // when the monthly quota is exhausted, handled by the caller).
    const alwaysAvailable = ["scan", "rephrase", "citation_audit", "paper_search"];
    if (alwaysAvailable.includes(feature)) {
        return { available: true, plan };
    }
    if (typeof limit === "boolean")
        return { available: limit, plan };
    if (limit === -1)
        return { available: true, plan };
    if (typeof limit === "number")
        return { available: limit > 0, plan };
    return { available: false, plan };
}
function safeMetadata(metadata) {
    // Drop referenceId from the stored JSON blob — it lives in its own column.
    const { referenceId: _referenceId, ...rest } = metadata;
    void _referenceId;
    return rest;
}
function prismaJsonMerge(metadata) {
    // prisma update on Json uses replacement by default; we expose a simple
    // object here so callers can pass arbitrary serializable metadata.
    return metadata;
}
