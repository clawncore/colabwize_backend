"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const platformAdmin_1 = require("../../middleware/platformAdmin");
const prisma_1 = require("../../lib/prisma");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const router = express_1.default.Router();
router.use(platformAdmin_1.isPlatformAdmin);
// Amounts are derived from real payment history (no hardcoded pricing or
// fabricated revenue figures). If a subscription has no recorded payment yet
// the amount defaults to 0 rather than inventing a number.
router.get("/", async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 500, 1000);
        const [subscriptions, payments, users] = await Promise.all([
            prisma_1.prisma.subscription.findMany({
                take: limit,
                orderBy: { created_at: "desc" },
                include: { user: { select: { id: true, email: true, full_name: true, created_at: true } } },
            }),
            prisma_1.prisma.paymentHistory.findMany({
                take: limit,
                orderBy: { created_at: "desc" },
                include: { user: { select: { id: true, email: true, full_name: true } } },
            }),
            prisma_1.prisma.user.findMany({
                take: limit,
                select: { id: true, email: true, full_name: true, created_at: true, last_seen_at: true },
            }),
        ]);
        // Latest payment amount per user (real price basis)
        const priceByUser = new Map();
        for (const p of payments) {
            if (!priceByUser.has(p.user_id)) {
                priceByUser.set(p.user_id, p.amount);
            }
        }
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const active = subscriptions.filter((s) => s.status === "active");
        const endingThisMonth = subscriptions.filter((s) => (s.cancel_at_period_end && s.renews_at && s.renews_at < nextMonth && s.renews_at >= startOfMonth) ||
            (s.ends_at && s.ends_at >= startOfMonth && s.ends_at < nextMonth));
        const lapsed = subscriptions.filter((s) => s.ends_at && s.ends_at < now);
        const mrr = active.reduce((sum, s) => sum + (priceByUser.get(s.user_id) ?? 0), 0);
        const churnRate = active.length > 0 ? `${((endingThisMonth.length / active.length) * 100).toFixed(1)}%` : "0%";
        const arpu = active.length > 0 ? mrr / active.length : 0;
        const totalPaidByUser = new Map();
        for (const p of payments) {
            if (p.status === "completed" || p.status === "paid") {
                totalPaidByUser.set(p.user_id, (totalPaidByUser.get(p.user_id) ?? 0) + p.amount);
            }
        }
        const overview = {
            totalActive: active.length,
            totalSubscriptions: subscriptions.length,
            newThisMonth: subscriptions.filter((s) => s.created_at >= startOfMonth).length,
            endingThisMonth: endingThisMonth.length,
            lapsed: lapsed.length,
            churnRate,
            mrr,
            arr: mrr * 12,
            arpu,
            ltv: active.length > 0 ? Array.from(totalPaidByUser.values()).reduce((a, b) => a + b, 0) / active.length : 0,
        };
        const subscriptionRows = subscriptions.map((s) => ({
            id: s.id,
            userId: s.user_id,
            userName: s.user?.full_name || "Unknown",
            userEmail: s.user?.email || "unknown",
            plan: s.plan,
            status: s.status,
            currentPeriodStart: s.current_period_start?.toISOString() ?? "",
            currentPeriodEnd: s.current_period_end?.toISOString() ?? "",
            renewsAt: s.renews_at?.toISOString() ?? "",
            amount: priceByUser.get(s.user_id) ?? 0,
            currency: "USD",
            lemonsqueezyCustomerId: s.lemonsqueezy_customer_id ?? undefined,
            lemonsqueezySubscriptionId: s.lemonsqueezy_subscription_id ?? undefined,
        }));
        const invoiceRows = payments.slice(0, 200).map((p, idx) => ({
            id: p.id,
            invoiceNumber: p.lemonsqueezy_order_id || `INV-${p.id.slice(0, 8)}`,
            userId: p.user_id,
            userName: p.user?.full_name || "Unknown",
            userEmail: p.user?.email || "unknown",
            amount: p.amount,
            currency: p.currency.toUpperCase(),
            status: p.status,
            issuedAt: p.created_at.toISOString(),
            dueAt: p.created_at.toISOString(),
            hostedUrl: p.receipt_url ?? undefined,
            pdfUrl: p.receipt_url ?? undefined,
            description: p.description ?? "Subscription payment",
        }));
        const paymentRows = payments.slice(0, 200).map((p) => ({
            id: p.id,
            orderId: p.lemonsqueezy_order_id,
            userId: p.user_id,
            userName: p.user?.full_name || "Unknown",
            userEmail: p.user?.email || "unknown",
            amount: p.amount,
            currency: p.currency.toUpperCase(),
            status: p.status,
            method: "LemonSqueezy",
            createdAt: p.created_at.toISOString(),
            description: p.description ?? "Subscription payment",
        }));
        const subByUser = new Map(subscriptions.map((s) => [s.user_id, s]));
        const customerRows = users.slice(0, 200).map((u) => {
            const sub = subByUser.get(u.id);
            return {
                id: u.id,
                name: u.full_name || u.email.split("@")[0],
                email: u.email,
                plan: sub?.plan ?? "Free",
                status: sub?.status ?? "active",
                joinedAt: u.created_at.toISOString(),
                lastActive: u.last_seen_at?.toISOString() ?? u.created_at.toISOString(),
                totalSpent: totalPaidByUser.get(u.id) ?? 0,
                invoicesCount: payments.filter((p) => p.user_id === u.id).length,
                lifetimeValue: totalPaidByUser.get(u.id) ?? 0,
            };
        });
        res.json({
            success: true,
            data: {
                overview,
                subscriptions: subscriptionRows,
                invoices: invoiceRows,
                payments: paymentRows,
                customers: customerRows,
            },
        });
    }
    catch (error) {
        logger_1.default.error("Revenue fetch error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.default = router;
