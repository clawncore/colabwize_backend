"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreditService = exports.CREDIT_PACKAGES = void 0;
exports.calculateCost = calculateCost;
const prisma_1 = require("../lib/prisma");
const logger_1 = __importDefault(require("../monitoring/logger"));
/**
 * CreditService — ledger-based credit accounting.
 *
 * The credit_transactions table is the immutable ledger and the single source
 * of truth. CreditBalance is a materialized cache kept in sync on every
 * mutation; `getBalance` always equals `SUM(credit_transactions.amount)` and
 * self-repairs if it ever drifts.
 *
 * Lifecycle (Option A — reservation as a ledger row, no separate table):
 *
 *   grant   → credit_transactions (+amount)      [PURCHASE | BONUS | REFUND]
 *   reserve → credit_transactions (-amount)      [USAGE]   balance drops now
 *   refund  → credit_transactions (+amount)      [REFUND]  on release/rollback
 *
 * Reserved credits count as spent the moment the hold is taken, so concurrent
 * reservations can never drive the balance negative. A release writes a REFUND
 * row, returning the credits.
 *
 * Idempotency: (reference_id, type) is unique, so replaying a webhook or a
 * retried hold cannot double-grant or double-deduct.
 */
// Credit grant sizes keyed by the `plan` field LemonSqueezy sends in the
// `order_created` webhook's custom_data. Kept here (rather than in the
// webhook file) so the mapping lives with the credit logic.
exports.CREDIT_PACKAGES = {
    // Current UI packages (authoritative — see CreditsPage.tsx)
    credits_trial: 5,
    credits_standard: 25,
    credits_power: 50,
    // Legacy package ids (kept for webhook backward-compat)
    credits_10: 10,
    credits_25: 25,
    credits_50: 50,
};
/**
 * Pricing engine.
 *
 * Rule of thumb: 1 credit = 1000 words processed. Per-feature tiers refine
 * this. Cost is dynamic on word count; metadata is required for all but the
 * fallback path.
 *
 *   scan / citation_audit   → ceil(words / 1000)            min 1
 *   rephrase                 → ceil((input+output) / 1000)  min 1
 *   ai_chat                  → ceil((input+output) / 2000)  min 1   (cheaper)
 *   originality/originality_scan → ceil(words/1000) × 0.5   min 1.5
 *   default                  → 1
 */
function calculateCost(feature, metadata) {
    // Fallback for legacy calls without metadata: a safe minimum so the call
    // still hits the ledger rather than being free.
    if (!metadata)
        return 1;
    let words = 0;
    switch (feature) {
        case "scan":
        case "citation_audit":
            words = metadata.wordCount || 0;
            return Math.max(1, Math.ceil(words / 1000));
        case "publish_export":
            // Phase 3: cost scales with document length, min 1 credit.
            words = metadata.wordCount || 0;
            return Math.max(1, Math.ceil(words / 1000));
        case "rephrase":
            words = (metadata.inputWords || 0) + (metadata.outputWords || 0);
            return Math.max(1, Math.ceil(words / 1000));
        case "ai_chat":
            words = (metadata.inputWords || 0) + (metadata.outputWords || 0);
            return Math.max(1, Math.ceil(words / 2000));
        // ── Originality billing disabled per request (code preserved) ──
        // case "originality":
        // case "originality_scan":
        //   words = metadata.wordCount || 0;
        //   const chunks = Math.ceil(words / 1000);
        //   const rawCost = chunks * 0.5;
        //   return Math.max(1.5, rawCost);
        default:
            return 1;
    }
}
class CreditService {
    /**
     * True balance = SUM of all ledger rows. This is the source of truth.
     */
    static async computeBalance(userId) {
        const agg = await prisma_1.prisma.creditTransaction.aggregate({
            where: { user_id: userId },
            _sum: { amount: true },
        });
        return agg._sum.amount || 0;
    }
    /**
     * Read the cached balance, self-repairing from the ledger if it drifted.
     * Kept fast for hot paths (e.g. /subscription/current) while staying correct.
     */
    static async getBalance(userId) {
        const cached = await prisma_1.prisma.creditBalance.findUnique({
            where: { user_id: userId },
        });
        const cachedBalance = cached?.balance ?? 0;
        const actual = await this.computeBalance(userId);
        if (cachedBalance !== actual) {
            logger_1.default.warn("CreditBalance cache drifted; repairing from ledger", {
                userId,
                cachedBalance,
                actual,
            });
            await prisma_1.prisma.creditBalance.upsert({
                where: { user_id: userId },
                create: {
                    user_id: userId,
                    balance: actual,
                    lifetime_purchased: 0,
                    lifetime_used: 0,
                },
                update: { balance: actual },
            });
        }
        return actual;
    }
    /**
     * Grant credits (purchase, bonus, or refund). Appends a positive ledger row
     * and refreshes the cache. Idempotent on (referenceId, type).
     */
    static async grantCredits(userId, amount, type, referenceId, description) {
        return await prisma_1.prisma.$transaction(async (tx) => {
            // Idempotency: a grant for this (reference, type) already exists → skip.
            if (referenceId) {
                const existing = await tx.creditTransaction.findFirst({
                    where: { reference_id: referenceId, type },
                });
                if (existing) {
                    logger_1.default.info("Credit grant skipped (idempotent)", {
                        userId,
                        referenceId,
                        type,
                    });
                    return tx.creditBalance.findUnique({ where: { user_id: userId } });
                }
            }
            await tx.creditTransaction.create({
                data: {
                    user_id: userId,
                    amount,
                    type,
                    reference_id: referenceId,
                    description,
                },
            });
            const balance = await tx.creditBalance.upsert({
                where: { user_id: userId },
                create: {
                    user_id: userId,
                    balance: amount,
                    lifetime_purchased: amount,
                    lifetime_used: 0,
                },
                update: {
                    balance: { increment: amount },
                    // Only PURCHASE/BONUS count toward lifetime purchased; REFUND does not.
                    lifetime_purchased: type === "REFUND"
                        ? undefined
                        : { increment: amount },
                },
            });
            logger_1.default.info("Credits granted", {
                userId,
                amount,
                type,
                newBalance: balance.balance,
            });
            return balance;
        });
    }
    /**
     * Reserve (hold) credits for an in-flight feature execution. Writes a
     * negative USAGE ledger row so the balance drops immediately — reserved
     * credits are treated as spent, which prevents concurrent holds from
     * overspending. Returns the ledger row id as the reservation id.
     *
     * Caller (BillingGateway) must call refundCredits on release to return them.
     */
    static async reserveCredits(userId, cost, referenceId) {
        if (cost <= 0) {
            // Zero-cost holds still need a reservation id for the release path to be
            // a no-op; write a zero-amount marker so idempotency still works.
            const row = await prisma_1.prisma.creditTransaction.create({
                data: {
                    user_id: userId,
                    amount: 0,
                    type: "USAGE",
                    reference_id: referenceId,
                    description: "Zero-cost reservation",
                },
            });
            return row.id;
        }
        return await prisma_1.prisma.$transaction(async (tx) => {
            // Idempotency: a reservation for this reference already exists → return it.
            if (referenceId) {
                const existing = await tx.creditTransaction.findFirst({
                    where: { reference_id: referenceId, type: "USAGE" },
                });
                if (existing) {
                    logger_1.default.info("Credit reservation skipped (idempotent)", {
                        userId,
                        referenceId,
                    });
                    return existing.id;
                }
            }
            // Verify sufficient balance before reserving (inside the tx, after we've
            // accounted for any concurrent reservations that already dropped it).
            const agg = await tx.creditTransaction.aggregate({
                where: { user_id: userId },
                _sum: { amount: true },
            });
            const balance = agg._sum.amount || 0;
            if (balance < cost) {
                throw new Error("Insufficient credit balance");
            }
            const row = await tx.creditTransaction.create({
                data: {
                    user_id: userId,
                    amount: -cost,
                    type: "USAGE",
                    reference_id: referenceId,
                    description: `Reservation for hold ${referenceId ?? "n/a"}`,
                },
            });
            await tx.creditBalance.update({
                where: { user_id: userId },
                data: {
                    balance: { decrement: cost },
                    lifetime_used: { increment: cost },
                },
            });
            logger_1.default.info("Credits reserved", { userId, cost, referenceId });
            return row.id;
        });
    }
    /**
     * Refund previously-reserved credits (release/rollback). Writes a positive
     * REFUND ledger row and restores the cache. Idempotent on (referenceId,
     * "REFUND") so a double-release cannot double-refund.
     */
    static async refundCredits(userId, amount, referenceId, description) {
        if (amount <= 0)
            return;
        await prisma_1.prisma.$transaction(async (tx) => {
            const existing = await tx.creditTransaction.findFirst({
                where: { reference_id: referenceId, type: "REFUND" },
            });
            if (existing) {
                logger_1.default.info("Credit refund skipped (idempotent)", {
                    userId,
                    referenceId,
                });
                return;
            }
            await tx.creditTransaction.create({
                data: {
                    user_id: userId,
                    amount,
                    type: "REFUND",
                    reference_id: referenceId,
                    description: description ?? `Refund for ${referenceId}`,
                },
            });
            await tx.creditBalance.update({
                where: { user_id: userId },
                data: {
                    balance: { increment: amount },
                    lifetime_used: { decrement: amount },
                },
            });
            logger_1.default.info("Credits refunded", { userId, amount, referenceId });
        });
    }
    /**
     * Check whether the user can afford a given cost.
     */
    static async hasEnoughCredits(userId, cost) {
        if (cost <= 0)
            return true;
        const balance = await this.getBalance(userId);
        return balance >= cost;
    }
}
exports.CreditService = CreditService;
