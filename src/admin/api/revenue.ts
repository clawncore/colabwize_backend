import express, { Router } from "express";
import { isPlatformAdmin } from "../middleware/platformAdmin";
import { adminOperationRateLimiter } from "../../middleware/rateLimiter";
import { prisma } from "../../lib/prisma";
import logger from "../../monitoring/logger";

const router: Router = express.Router();

router.use(isPlatformAdmin);
router.use(adminOperationRateLimiter);

interface SubscriptionRow {
  id: string;
  user_id: string;
  plan: string;
  status: string;
  cancel_at_period_end?: boolean | null;
  renews_at?: Date | null;
  ends_at?: Date | null;
  created_at: Date;
  current_period_start?: Date | null;
  current_period_end?: Date | null;
  lemonsqueezy_customer_id?: string | null;
  lemonsqueezy_subscription_id?: string | null;
  user?: { id: string; email: string; full_name: string | null; created_at: Date } | null;
}

interface PaymentRow {
  id: string;
  user_id: string;
  lemonsqueezy_order_id: string;
  amount: number;
  currency: string;
  status: string;
  receipt_url?: string | null;
  description?: string | null;
  created_at: Date;
  user?: { id: string; email: string; full_name: string | null } | null;
}

interface UserRow {
  id: string;
  email: string;
  full_name: string | null;
  created_at: Date;
  last_seen_at?: Date | null;
}

// Amounts are derived from real payment history (no hardcoded pricing or
// fabricated revenue figures). If a subscription has no recorded payment yet
// the amount defaults to 0 rather than inventing a number.
router.get("/", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 500, 1000);
    
    const [subscriptions, payments, users] = await Promise.all([
      prisma.subscription.findMany({
        take: limit,
        orderBy: { created_at: "desc" },
        include: { user: { select: { id: true, email: true, full_name: true, created_at: true } } },
      }),
      prisma.paymentHistory.findMany({
        take: limit,
        orderBy: { created_at: "desc" },
        include: { user: { select: { id: true, email: true, full_name: true } } },
      }),
      prisma.user.findMany({
        take: limit,
        select: { id: true, email: true, full_name: true, created_at: true, last_seen_at: true },
      }),
    ]);

    // Latest payment amount per user (real price basis)
    const priceByUser = new Map<string, number>();
    for (const p of payments) {
      if (!priceByUser.has(p.user_id)) {
        priceByUser.set(p.user_id, p.amount);
      }
    }

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const active = subscriptions.filter((s: SubscriptionRow) => s.status === "active");
    const endingThisMonth = subscriptions.filter((s: SubscriptionRow) =>
      (s.cancel_at_period_end && s.renews_at && s.renews_at < nextMonth && s.renews_at >= startOfMonth) ||
      (s.ends_at && s.ends_at >= startOfMonth && s.ends_at < nextMonth),
    );
    const lapsed = subscriptions.filter((s: SubscriptionRow) => s.ends_at && s.ends_at < now);

    const mrr = active.reduce((sum: number, s: SubscriptionRow) => sum + (priceByUser.get(s.user_id) ?? 0), 0);
    const churnRate =
      active.length > 0 ? `${((endingThisMonth.length / active.length) * 100).toFixed(1)}%` : "0%";
    const arpu = active.length > 0 ? mrr / active.length : 0;

    const totalPaidByUser = new Map<string, number>();
    for (const p of payments) {
      if (p.status === "completed" || p.status === "paid") {
        totalPaidByUser.set(p.user_id, (totalPaidByUser.get(p.user_id) ?? 0) + p.amount);
      }
    }

    const overview = {
      totalActive: active.length,
      totalSubscriptions: subscriptions.length,
      newThisMonth: subscriptions.filter((s: SubscriptionRow) => s.created_at >= startOfMonth).length,
      endingThisMonth: endingThisMonth.length,
      lapsed: lapsed.length,
      churnRate,
      mrr,
      arr: mrr * 12,
      arpu,
      ltv: active.length > 0 ? Array.from(totalPaidByUser.values()).reduce((a, b) => a + b, 0) / active.length : 0,
    };

    const subscriptionRows = subscriptions.map((s: SubscriptionRow) => ({
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

    const invoiceRows = payments.slice(0, 200).map((p: PaymentRow, idx: number) => ({
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

    const paymentRows = payments.slice(0, 200).map((p: PaymentRow) => ({
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

    const subByUser = new Map(subscriptions.map((s: SubscriptionRow) => [s.user_id, s]));
    const customerRows = users.slice(0, 200).map((u: UserRow) => {
      const sub = subByUser.get(u.id);
      return {
        id: u.id,
        name: u.full_name || u.email.split("@")[0],
        email: u.email,
        plan: (sub as SubscriptionRow | undefined)?.plan ?? "Free",
        status: (sub as SubscriptionRow | undefined)?.status ?? "active",
        joinedAt: u.created_at.toISOString(),
        lastActive: u.last_seen_at?.toISOString() ?? u.created_at.toISOString(),
        totalSpent: totalPaidByUser.get(u.id) ?? 0,
        invoicesCount: payments.filter((p: PaymentRow) => p.user_id === u.id).length,
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
  } catch (error: any) {
    logger.error("Revenue fetch error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
