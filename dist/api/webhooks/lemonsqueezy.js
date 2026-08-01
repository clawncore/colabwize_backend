"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_2 = __importDefault(require("express"));
const lemonSqueezyService_1 = require("../../services/lemonSqueezyService");
const subscriptionService_1 = require("../../services/subscriptionService");
const CreditService_1 = require("../../services/CreditService");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const prisma_1 = require("../../lib/prisma");
const router = (0, express_1.Router)();
/**
 * LemonSqueezy Webhook Handler
 * CRITICAL: This route MUST bypass all auth middleware
 * Uses signature verification ONLY, never JWT/session
 * MUST use express.raw() to capture raw body for signature verification
 */
router.post("/lemonsqueezy", express_2.default.raw({ type: "application/json" }), async (req, res) => {
    // 1. Get signature and raw body
    const signature = req.headers["x-signature"];
    const rawBody = req.body; // This is a Buffer from express.raw()
    // 2. Verify signature (ONLY reason to reject)
    try {
        if (!signature) {
            logger_1.default.warn("Webhook missing signature");
            return res.status(401).json({ error: "Missing signature" });
        }
        if (!rawBody || !Buffer.isBuffer(rawBody)) {
            logger_1.default.warn("Webhook missing raw body");
            return res.status(400).json({ error: "Missing body" });
        }
        const isValid = await lemonSqueezyService_1.LemonSqueezyService.verifyWebhookSignature(rawBody, signature);
        if (!isValid) {
            logger_1.default.warn("Invalid webhook signature");
            return res.status(401).json({ error: "Invalid signature" });
        }
    }
    catch (error) {
        logger_1.default.error("Signature verification error", { error: error.message });
        return res.status(500).json({ error: "Verification failed" });
    }
    // 3. ACK IMMEDIATELY (never block on business logic)
    res.status(200).json({ received: true });
    // 4. Process async (fire-and-forget)
    // Convert Buffer to string for processing
    const payload = rawBody.toString("utf8");
    processWebhookAsync(payload).catch((error) => {
        logger_1.default.error("Webhook async processing error", {
            error: error.message,
            stack: error.stack,
        });
    });
});
/**
 * Async webhook processor (never blocks HTTP response)
 */
async function processWebhookAsync(payload) {
    let event, eventName, eventId, webhookId;
    try {
        event = JSON.parse(payload);
        eventName = event.meta?.event_name;
        eventId = event.meta?.event_id || event.data?.id;
        webhookId = event.meta?.webhook_id;
    }
    catch (parseError) {
        logger_1.default.error("Failed to parse webhook", { error: parseError.message });
        return;
    }
    if (!eventName) {
        logger_1.default.error("Webhook missing event_name");
        return;
    }
    // Security-safe logging (no PII)
    logger_1.default.info("Processing webhook", { eventName, eventId, webhookId });
    // Idempotency check
    try {
        const existingEvent = await prisma_1.prisma.webhookEvent.findFirst({
            where: {
                OR: [{ event_id: eventId }, { event_id: webhookId }],
            },
        });
        if (existingEvent) {
            logger_1.default.info("Webhook already processed", { eventId, webhookId });
            return;
        }
    }
    catch (dbError) {
        logger_1.default.error("Idempotency check failed", { error: dbError.message });
        // Continue - better to process twice than never
    }
    // Process event
    try {
        switch (eventName) {
            case "order_created":
                await handleOrderCreated(event);
                break;
            case "subscription_created":
                await handleSubscriptionCreated(event);
                break;
            case "subscription_updated":
                await handleSubscriptionUpdated(event);
                break;
            case "subscription_cancelled":
                await handleSubscriptionCancelled(event);
                break;
            case "subscription_resumed":
                await handleSubscriptionResumed(event);
                break;
            case "subscription_expired":
                await handleSubscriptionExpired(event);
                break;
            case "subscription_paused":
                await handleSubscriptionPaused(event);
                break;
            case "subscription_unpaused":
                await handleSubscriptionUnpaused(event);
                break;
            case "subscription_payment_success":
                await handleSubscriptionPaymentSuccess(event);
                break;
            case "order_refunded":
            case "subscription_payment_refunded":
                await handleRefundEvent(event, eventName);
                break;
            default:
                logger_1.default.info("Unhandled webhook event", { eventName });
        }
        // Persist event
        try {
            await prisma_1.prisma.webhookEvent.create({
                data: {
                    event_id: webhookId || eventId,
                    event_name: eventName,
                    payload: payload,
                    processed_at: new Date(),
                },
            });
        }
        catch (persistError) {
            logger_1.default.error("Failed to persist webhook", {
                error: persistError.message,
            });
        }
    }
    catch (processingError) {
        logger_1.default.error("Webhook processing failed", {
            eventName,
            error: processingError.message,
            stack: processingError.stack,
        });
    }
}
// Credit plan mapping lives in CreditService (CREDIT_PACKAGES); imported above.
/**
 * Handle order_created event (one-time purchases like credits)
 */
async function handleOrderCreated(event) {
    const data = event.data;
    const customData = event.meta?.custom_data || data.attributes.custom_data;
    const userId = customData?.user_id;
    const plan = customData?.plan;
    const variantName = data.attributes.variant_name;
    const orderId = data.id;
    if (!userId) {
        logger_1.default.warn("Order created without user_id");
        return;
    }
    logger_1.default.info("Order created", { userId, plan, variantName, orderId });
    // Check if this is a credit purchase
    let creditAmount = 0;
    if (plan && plan.startsWith("credits_")) {
        creditAmount = CreditService_1.CREDIT_PACKAGES[plan] || 0;
    }
    else if (variantName) {
        // Fallback: parse from variant name
        const match = variantName.match(/CREDITS[_\s](\d+)/i);
        if (match) {
            creditAmount = parseInt(match[1], 10);
        }
    }
    if (creditAmount > 0) {
        try {
            await CreditService_1.CreditService.grantCredits(userId, creditAmount, "PURCHASE", orderId, `Purchase: ${plan || variantName}`);
            logger_1.default.info("Credits granted", {
                userId,
                amount: creditAmount,
                plan,
                orderId,
            });
        }
        catch (creditError) {
            logger_1.default.error("Failed to grant credits", {
                error: creditError.message,
                userId,
                plan,
                orderId,
            });
        }
    }
    // Persist Payment History
    try {
        await prisma_1.prisma.paymentHistory.upsert({
            where: { lemonsqueezy_order_id: orderId.toString() },
            create: {
                user_id: userId,
                lemonsqueezy_order_id: orderId.toString(),
                amount: parseInt(data.attributes.total),
                currency: data.attributes.currency,
                status: data.attributes.status,
                receipt_url: data.attributes.urls?.receipt,
                description: `One-time purchase: ${variantName || "Credits"}`,
                created_at: new Date(data.attributes.created_at),
            },
            update: {
                status: data.attributes.status,
                receipt_url: data.attributes.urls?.receipt,
            },
        });
        logger_1.default.info("Payment history recorded for order", { orderId, userId });
    }
    catch (error) {
        logger_1.default.error("Failed to record payment history", {
            error: error.message,
            orderId,
        });
    }
}
/**
 * Handle subscription_created event
 */
async function handleSubscriptionCreated(event) {
    const data = event.data;
    const customData = event.meta?.custom_data || data.attributes.custom_data;
    const userId = customData?.user_id;
    const plan = customData?.plan || "student";
    if (!userId) {
        logger_1.default.warn("Subscription created without user_id");
        return;
    }
    await subscriptionService_1.SubscriptionService.upsertSubscription(userId, {
        plan,
        status: data.attributes.status,
        lemonsqueezy_customer_id: data.attributes.customer_id.toString(),
        lemonsqueezy_subscription_id: data.id,
        variant_id: data.attributes.variant_id.toString(),
        current_period_start: new Date(data.attributes.created_at),
        current_period_end: new Date(data.attributes.renews_at),
        renews_at: new Date(data.attributes.renews_at),
        entitlement_expires_at: new Date(data.attributes.renews_at),
    });
    logger_1.default.info("Subscription created", { userId, plan });
}
/**
 * Handle subscription_updated event
 */
async function handleSubscriptionUpdated(event) {
    const data = event.data;
    const customData = event.meta?.custom_data || data.attributes.custom_data;
    const userId = customData?.user_id;
    const plan = customData?.plan || "student";
    if (!userId) {
        logger_1.default.warn("Subscription updated without user_id");
        return;
    }
    await subscriptionService_1.SubscriptionService.upsertSubscription(userId, {
        plan,
        status: data.attributes.status,
        variant_id: data.attributes.variant_id.toString(),
        renews_at: data.attributes.renews_at
            ? new Date(data.attributes.renews_at)
            : undefined,
        ends_at: data.attributes.ends_at
            ? new Date(data.attributes.ends_at)
            : undefined,
        entitlement_expires_at: data.attributes.ends_at
            ? new Date(data.attributes.ends_at)
            : new Date(data.attributes.renews_at),
    });
    logger_1.default.info("Subscription updated", { userId, plan });
}
/**
 * Handle subscription_cancelled event
 */
async function handleSubscriptionCancelled(event) {
    const data = event.data;
    const customData = event.meta?.custom_data || data.attributes.custom_data;
    const userId = customData?.user_id;
    if (!userId) {
        logger_1.default.warn("Subscription cancelled without user_id");
        return;
    }
    // Determine the plan to preserve during cancellation period
    // We prefer the plan from customData, fallback to current plan in DB
    let plan = customData?.plan;
    if (!plan) {
        const currentSub = await subscriptionService_1.SubscriptionService.getUserSubscription(userId);
        plan = currentSub?.plan || "free";
    }
    await subscriptionService_1.SubscriptionService.upsertSubscription(userId, {
        plan,
        status: "cancelled",
        ends_at: data.attributes.ends_at
            ? new Date(data.attributes.ends_at)
            : undefined,
        entitlement_expires_at: data.attributes.ends_at
            ? new Date(data.attributes.ends_at)
            : new Date(),
    });
    logger_1.default.info("Subscription cancelled", { userId });
}
/**
 * Handle subscription_resumed event
 */
async function handleSubscriptionResumed(event) {
    const data = event.data;
    const customData = event.meta?.custom_data || data.attributes.custom_data;
    const userId = customData?.user_id;
    const plan = customData?.plan || "student";
    if (!userId) {
        logger_1.default.warn("Subscription resumed without user_id");
        return;
    }
    await subscriptionService_1.SubscriptionService.upsertSubscription(userId, {
        plan,
        status: "active",
        ends_at: undefined,
        renews_at: data.attributes.renews_at
            ? new Date(data.attributes.renews_at)
            : undefined,
        entitlement_expires_at: new Date(data.attributes.renews_at),
    });
    logger_1.default.info("Subscription resumed", { userId });
}
/**
 * Handle subscription_expired event
 */
async function handleSubscriptionExpired(event) {
    const data = event.data;
    const customData = event.meta?.custom_data || data.attributes.custom_data;
    const userId = customData?.user_id;
    if (!userId) {
        logger_1.default.warn("Subscription expired without user_id");
        return;
    }
    await subscriptionService_1.SubscriptionService.upsertSubscription(userId, {
        plan: "free",
        status: "expired",
        entitlement_expires_at: new Date(),
    });
    logger_1.default.info("Subscription expired", { userId });
}
/**
 * Handle subscription_paused event
 */
async function handleSubscriptionPaused(event) {
    const data = event.data;
    const customData = event.meta?.custom_data || data.attributes.custom_data;
    const userId = customData?.user_id;
    const plan = customData?.plan || "student";
    if (!userId) {
        logger_1.default.warn("Subscription paused without user_id");
        return;
    }
    await subscriptionService_1.SubscriptionService.upsertSubscription(userId, {
        plan,
        status: "paused",
    });
    logger_1.default.info("Subscription paused", { userId });
}
/**
 * Handle subscription_unpaused event
 */
async function handleSubscriptionUnpaused(event) {
    const data = event.data;
    const customData = event.meta?.custom_data || data.attributes.custom_data;
    const userId = customData?.user_id;
    const plan = customData?.plan || "student";
    if (!userId) {
        logger_1.default.warn("Subscription unpaused without user_id");
        return;
    }
    await subscriptionService_1.SubscriptionService.upsertSubscription(userId, {
        plan,
        status: "active",
    });
    logger_1.default.info("Subscription unpaused", { userId });
}
/**
 * Handle subscription_payment_success event
 */
async function handleSubscriptionPaymentSuccess(event) {
    const data = event.data;
    const customData = event.meta?.custom_data || data.attributes.custom_data;
    const userId = customData?.user_id;
    const plan = customData?.plan || "student";
    if (!userId) {
        logger_1.default.warn("Payment success without user_id");
        return;
    }
    await subscriptionService_1.SubscriptionService.upsertSubscription(userId, {
        plan,
        status: "active",
        renews_at: data.attributes.renews_at
            ? new Date(data.attributes.renews_at)
            : undefined,
        entitlement_expires_at: new Date(data.attributes.renews_at),
    });
    logger_1.default.info("Payment success", { userId });
    // Persist Payment History for Subscription Renewal/Payment
    try {
        const orderId = data.attributes.order_id?.toString() || data.id; // Usually subscription invoice has an order ID reference
        await prisma_1.prisma.paymentHistory.upsert({
            where: { lemonsqueezy_order_id: orderId },
            create: {
                user_id: userId,
                lemonsqueezy_order_id: orderId,
                amount: parseInt(data.attributes.total),
                currency: data.attributes.currency,
                status: data.attributes.status,
                receipt_url: data.attributes.urls?.receipt,
                description: `Subscription Payment: ${plan}`,
                created_at: new Date(data.attributes.created_at),
            },
            update: {
                status: data.attributes.status,
                receipt_url: data.attributes.urls?.receipt,
            },
        });
        logger_1.default.info("Payment history recorded for subscription", {
            orderId,
            userId,
        });
    }
    catch (error) {
        logger_1.default.error("Failed to record subscription payment history", {
            error: error.message,
            userId,
        });
    }
}
/**
 * Handle refund events
 */
async function handleRefundEvent(event, eventName) {
    const data = event.data;
    const customData = event.meta?.custom_data || data.attributes.custom_data;
    const userId = customData?.user_id;
    const orderId = data.id; // Use order ID as reference
    if (!userId) {
        logger_1.default.warn("Refund event without user_id", { eventName });
        return;
    }
    logger_1.default.info("Refund event", { userId, eventName });
    // Handle based on what was refunded
    if (eventName === "order_refunded") {
        const plan = customData?.plan;
        if (plan?.startsWith("credits_")) {
            const creditAmount = CreditService_1.CREDIT_PACKAGES[plan];
            if (creditAmount) {
                try {
                    // Revoke the granted credits by writing a negative USAGE ledger row,
                    // keyed on the refund reference so it's idempotent across webhook
                    // replays. If the user already spent some, this may drive the balance
                    // negative — that is intentional debt for a refunded purchase.
                    await prisma_1.prisma.creditTransaction.create({
                        data: {
                            user_id: userId,
                            amount: -creditAmount,
                            type: "USAGE",
                            reference_id: `REFUND_${orderId}`,
                            description: `Refund revocation for ${plan}`,
                        },
                    });
                    // Refresh the materialized cache to reflect the revocation.
                    const newBalance = await CreditService_1.CreditService.computeBalance(userId);
                    await prisma_1.prisma.creditBalance.upsert({
                        where: { user_id: userId },
                        create: {
                            user_id: userId,
                            balance: newBalance,
                            lifetime_purchased: 0,
                            lifetime_used: 0,
                        },
                        update: { balance: newBalance },
                    });
                    logger_1.default.info("Credits revoked due to refund", {
                        userId,
                        amount: creditAmount,
                        newBalance,
                    });
                }
                catch (error) {
                    logger_1.default.error("Failed to revoke credits", {
                        error: error.message,
                        userId,
                    });
                }
            }
        }
    }
    else if (eventName === "subscription_payment_refunded") {
        await subscriptionService_1.SubscriptionService.upsertSubscription(userId, {
            plan: "free",
            status: "cancelled",
            entitlement_expires_at: new Date(),
        });
        logger_1.default.info("Subscription cancelled due to refund", { userId });
    }
}
exports.default = router;
