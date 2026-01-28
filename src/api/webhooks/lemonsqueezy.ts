import { Router } from "express";
import express from "express";
import { LemonSqueezyService } from "../../services/lemonSqueezyService";
import { SubscriptionService } from "../../services/subscriptionService";
import { CreditService } from "../../services/CreditService";
import { EmailService } from "../../services/emailService";
import logger from "../../monitoring/logger";
import { prisma } from "../../lib/prisma";

const router = Router();

/**
 * LemonSqueezy Webhook Handler
 * CRITICAL: This route MUST bypass all auth middleware
 * Uses signature verification ONLY, never JWT/session
 * MUST use express.raw() to capture raw body for signature verification
 */
router.post(
  "/lemonsqueezy",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    // 1. Get signature and raw body
    const signature = req.headers["x-signature"] as string | undefined;
    const rawBody = req.body; // This is a Buffer from express.raw()

    // 2. Verify signature (ONLY reason to reject)
    try {
      if (!signature) {
        logger.warn("Webhook missing signature");
        return res.status(401).json({ error: "Missing signature" });
      }

      if (!rawBody || !Buffer.isBuffer(rawBody)) {
        logger.warn("Webhook missing raw body");
        return res.status(400).json({ error: "Missing body" });
      }

      const isValid = await LemonSqueezyService.verifyWebhookSignature(rawBody, signature);
      if (!isValid) {
        logger.warn("Invalid webhook signature");
        return res.status(401).json({ error: "Invalid signature" });
      }
    } catch (error: any) {
      logger.error("Signature verification error", { error: error.message });
      return res.status(500).json({ error: "Verification failed" });
    }

    // 3. ACK IMMEDIATELY (never block on business logic)
    res.status(200).json({ received: true });

    // 4. Process async (fire-and-forget)
    // Convert Buffer to string for processing
    const payload = rawBody.toString("utf8");
    processWebhookAsync(payload).catch((error) => {
      logger.error("Webhook async processing error", {
        error: error.message,
        stack: error.stack
      });
    });
  }
);

/**
 * Async webhook processor (never blocks HTTP response)
 */
async function processWebhookAsync(payload: string): Promise<void> {
  let event, eventName, eventId, webhookId;

  try {
    event = JSON.parse(payload);
    eventName = event.meta?.event_name;
    eventId = event.meta?.event_id || event.data?.id;
    webhookId = event.meta?.webhook_id;
  } catch (parseError: any) {
    logger.error("Failed to parse webhook", { error: parseError.message });
    return;
  }

  if (!eventName) {
    logger.error("Webhook missing event_name");
    return;
  }

  // Security-safe logging (no PII)
  logger.info("Processing webhook", { eventName, eventId, webhookId });

  // Idempotency check
  try {
    const existingEvent = await prisma.webhookEvent.findFirst({
      where: {
        OR: [
          { event_id: eventId },
          { event_id: webhookId }
        ]
      }
    });

    if (existingEvent) {
      logger.info("Webhook already processed", { eventId, webhookId });
      return;
    }
  } catch (dbError: any) {
    logger.error("Idempotency check failed", { error: dbError.message });
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
        logger.info("Unhandled webhook event", { eventName });
    }

    // Persist event
    try {
      await prisma.webhookEvent.create({
        data: {
          event_id: webhookId || eventId,
          event_name: eventName,
          payload: payload,
          processed_at: new Date(),
        },
      });
    } catch (persistError: any) {
      logger.error("Failed to persist webhook", { error: persistError.message });
    }
  } catch (processingError: any) {
    logger.error("Webhook processing failed", {
      eventName,
      error: processingError.message,
      stack: processingError.stack
    });
  }
}

// Credit plan mapping
const CREDIT_PLAN_MAPPING: Record<string, number> = {
  credits_10: 10,
  credits_25: 25,
  credits_50: 50,
  credits_100: 100,
  // New Plan Mappings
  credits_trial: 10,
  credits_standard: 25,
  credits_power: 50,
};

/**
 * Handle order_created event (one-time purchases like credits)
 */
async function handleOrderCreated(event: any) {
  const data = event.data;
  const customData = event.meta?.custom_data || data.attributes.custom_data;
  const userId = customData?.user_id;
  const plan = customData?.plan;
  const variantName = data.attributes.variant_name;
  const orderId = data.id;

  if (!userId) {
    logger.warn("Order created without user_id");
    return;
  }

  logger.info("Order created", { userId, plan, variantName, orderId });

  // Check if this is a credit purchase
  let creditAmount = 0;

  if (plan && plan.startsWith("credits_")) {
    creditAmount = CREDIT_PLAN_MAPPING[plan] || 0;
  } else if (variantName) {
    // Fallback: parse from variant name
    const match = variantName.match(/CREDITS[_\s](\d+)/i);
    if (match) {
      creditAmount = parseInt(match[1], 10);
    }
  }

  if (creditAmount > 0) {
    try {
      await CreditService.addCredits(
        userId,
        creditAmount,
        "PURCHASE",
        orderId,
        `Purchase: ${plan || variantName}`
      );

      logger.info("Credits granted", { userId, amount: creditAmount, plan, orderId });
    } catch (creditError: any) {
      logger.error("Failed to grant credits", {
        error: creditError.message,
        userId,
        plan,
        orderId
      });
    }
  }

  // Persist Payment History
  try {
    await prisma.paymentHistory.upsert({
      where: { lemonsqueezy_order_id: orderId.toString() },
      create: {
        user_id: userId,
        lemonsqueezy_order_id: orderId.toString(),
        amount: parseInt(data.attributes.total),
        currency: data.attributes.currency,
        status: data.attributes.status,
        receipt_url: data.attributes.urls?.receipt,
        description: `One-time purchase: ${variantName || 'Credits'}`,
        created_at: new Date(data.attributes.created_at),
      },
      update: {
        status: data.attributes.status,
        receipt_url: data.attributes.urls?.receipt,
      }
    });
    logger.info("Payment history recorded for order", { orderId, userId });
  } catch (error: any) {
    logger.error("Failed to record payment history", { error: error.message, orderId });
  }
}

/**
 * Handle subscription_created event
 */
async function handleSubscriptionCreated(event: any) {
  const data = event.data;
  const customData = event.meta?.custom_data || data.attributes.custom_data;
  const userId = customData?.user_id;
  const plan = customData?.plan || "student";

  if (!userId) {
    logger.warn("Subscription created without user_id");
    return;
  }

  await SubscriptionService.upsertSubscription(userId, {
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

  logger.info("Subscription created", { userId, plan });
}

/**
 * Handle subscription_updated event
 */
async function handleSubscriptionUpdated(event: any) {
  const data = event.data;
  const customData = event.meta?.custom_data || data.attributes.custom_data;
  const userId = customData?.user_id;
  const plan = customData?.plan || "student";

  if (!userId) {
    logger.warn("Subscription updated without user_id");
    return;
  }

  await SubscriptionService.upsertSubscription(userId, {
    plan,
    status: data.attributes.status,
    variant_id: data.attributes.variant_id.toString(),
    renews_at: data.attributes.renews_at ? new Date(data.attributes.renews_at) : undefined,
    ends_at: data.attributes.ends_at ? new Date(data.attributes.ends_at) : undefined,
    entitlement_expires_at: data.attributes.ends_at
      ? new Date(data.attributes.ends_at)
      : new Date(data.attributes.renews_at),
  });

  logger.info("Subscription updated", { userId, plan });
}

/**
 * Handle subscription_cancelled event
 */
async function handleSubscriptionCancelled(event: any) {
  const data = event.data;
  const customData = event.meta?.custom_data || data.attributes.custom_data;
  const userId = customData?.user_id;

  if (!userId) {
    logger.warn("Subscription cancelled without user_id");
    return;
  }

  await SubscriptionService.upsertSubscription(userId, {
    plan: "free",
    status: "cancelled",
    ends_at: data.attributes.ends_at ? new Date(data.attributes.ends_at) : undefined,
    entitlement_expires_at: data.attributes.ends_at
      ? new Date(data.attributes.ends_at)
      : new Date(),
  });

  logger.info("Subscription cancelled", { userId });
}

/**
 * Handle subscription_resumed event
 */
async function handleSubscriptionResumed(event: any) {
  const data = event.data;
  const customData = event.meta?.custom_data || data.attributes.custom_data;
  const userId = customData?.user_id;
  const plan = customData?.plan || "student";

  if (!userId) {
    logger.warn("Subscription resumed without user_id");
    return;
  }

  await SubscriptionService.upsertSubscription(userId, {
    plan,
    status: "active",
    ends_at: undefined,
    renews_at: data.attributes.renews_at ? new Date(data.attributes.renews_at) : undefined,
    entitlement_expires_at: new Date(data.attributes.renews_at),
  });

  logger.info("Subscription resumed", { userId });
}

/**
 * Handle subscription_expired event
 */
async function handleSubscriptionExpired(event: any) {
  const data = event.data;
  const customData = event.meta?.custom_data || data.attributes.custom_data;
  const userId = customData?.user_id;

  if (!userId) {
    logger.warn("Subscription expired without user_id");
    return;
  }

  await SubscriptionService.upsertSubscription(userId, {
    plan: "free",
    status: "expired",
    entitlement_expires_at: new Date(),
  });

  logger.info("Subscription expired", { userId });
}

/**
 * Handle subscription_paused event
 */
async function handleSubscriptionPaused(event: any) {
  const data = event.data;
  const customData = event.meta?.custom_data || data.attributes.custom_data;
  const userId = customData?.user_id;
  const plan = customData?.plan || "student";

  if (!userId) {
    logger.warn("Subscription paused without user_id");
    return;
  }

  await SubscriptionService.upsertSubscription(userId, {
    plan,
    status: "paused",
  });

  logger.info("Subscription paused", { userId });
}

/**
 * Handle subscription_unpaused event
 */
async function handleSubscriptionUnpaused(event: any) {
  const data = event.data;
  const customData = event.meta?.custom_data || data.attributes.custom_data;
  const userId = customData?.user_id;
  const plan = customData?.plan || "student";

  if (!userId) {
    logger.warn("Subscription unpaused without user_id");
    return;
  }

  await SubscriptionService.upsertSubscription(userId, {
    plan,
    status: "active",
  });

  logger.info("Subscription unpaused", { userId });
}

/**
 * Handle subscription_payment_success event
 */
async function handleSubscriptionPaymentSuccess(event: any) {
  const data = event.data;
  const customData = event.meta?.custom_data || data.attributes.custom_data;
  const userId = customData?.user_id;
  const plan = customData?.plan || "student";

  if (!userId) {
    logger.warn("Payment success without user_id");
    return;
  }

  await SubscriptionService.upsertSubscription(userId, {
    plan,
    status: "active",
    renews_at: data.attributes.renews_at ? new Date(data.attributes.renews_at) : undefined,
    entitlement_expires_at: new Date(data.attributes.renews_at),
  });

  logger.info("Payment success", { userId });

  // Persist Payment History for Subscription Renewal/Payment
  try {
    const orderId = data.attributes.order_id?.toString() || data.id; // Usually subscription invoice has an order ID reference
    await prisma.paymentHistory.upsert({
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
      }
    });
    logger.info("Payment history recorded for subscription", { orderId, userId });
  } catch (error: any) {
    logger.error("Failed to record subscription payment history", { error: error.message, userId });
  }
}

/**
 * Handle refund events
 */
async function handleRefundEvent(event: any, eventName: string) {
  const data = event.data;
  const customData = event.meta?.custom_data || data.attributes.custom_data;
  const userId = customData?.user_id;
  const orderId = data.id; // Use order ID as reference

  if (!userId) {
    logger.warn("Refund event without user_id", { eventName });
    return;
  }

  logger.info("Refund event", { userId, eventName });

  // Handle based on what was refunded
  if (eventName === "order_refunded") {
    const plan = customData?.plan;
    if (plan?.startsWith("credits_")) {
      const creditAmount = CREDIT_PLAN_MAPPING[plan];
      if (creditAmount) {
        try {
          await CreditService.deductCredits(
            userId,
            creditAmount,
            `REFUND_${orderId}`,
            `Refund for ${plan}`
          );
          logger.info("Credits revoked due to refund", { userId, amount: creditAmount });
        } catch (error: any) {
          logger.error("Failed to revoke credits", { error: error.message, userId });
        }
      }
    }
  } else if (eventName === "subscription_payment_refunded") {
    await SubscriptionService.upsertSubscription(userId, {
      plan: "free",
      status: "cancelled",
      entitlement_expires_at: new Date(),
    });
    logger.info("Subscription cancelled due to refund", { userId });
  }
}

export default router;
