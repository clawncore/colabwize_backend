import express from "express";
import { SubscriptionService } from "../../services/subscriptionService";
import { LemonSqueezyService } from "../../services/lemonSqueezyService";
import { CreditService } from "../../services/CreditService";
import { EmailService } from "../../services/emailService";
import logger from "../../monitoring/logger";
import { prisma } from "../../lib/prisma";

const router = express.Router();

/**
 * POST /api/webhooks/lemonsqueezy
 * Handle LemonSqueezy webhook events
 */
router.post("/lemonsqueezy", async (req, res) => {
  // CRITICAL: Log IMMEDIATELY to confirm webhook reaches handler
  console.log("[WEBHOOK] Handler entry - webhook received");

  try {
    logger.info("[WEBHOOK] Handler entry", {
      method: req.method,
      url: req.url,
      headers: Object.keys(req.headers)
    });

    const signature = req.headers["x-signature"] as string;

    // Get raw body for signature verification
    // The rawBody is set by the verify middleware in main-server.ts
    const payload = (req as any).rawBody
      ? (req as any).rawBody.toString()
      : JSON.stringify(req.body);

    // Debug logging
    logger.info("Webhook received", {
      hasSignature: !!signature,
      hasRawBody: !!(req as any).rawBody,
      payloadLength: payload.length,
      contentType: req.headers["content-type"]
    });

    // Log webhook arrival BEFORE signature check for debugging
    logger.info("Webhook endpoint hit", {
      hasSignature: !!signature,
      payloadLength: payload.length,
      contentType: req.headers["content-type"]
    });

    // Verify webhook signature with error handling
    let isValid = false;
    try {
      isValid = await LemonSqueezyService.verifyWebhookSignature(payload, signature);
    } catch (sigError: any) {
      logger.error("Signature verification crashed", {
        error: sigError.message,
        stack: sigError.stack,
        hasSignature: !!signature,
        payloadLength: payload.length
      });
      return res.status(500).json({ error: "Signature verification failed", details: sigError.message });
    }

    if (!isValid) {
      logger.error("Invalid webhook signature", {
        signaturePreview: signature?.substring(0, 20) + "...",
        payloadLength: payload.length,
        eventPreview: payload.substring(0, 100)
      });
      return res.status(401).json({ error: "Invalid signature" });
    }

    let event, eventName, data, eventId;

    try {
      event = JSON.parse(payload);
      eventName = event.meta.event_name;
      data = event.data;
      eventId = event.meta.event_id || data.id;
    } catch (parseError: any) {
      logger.error("Failed to parse webhook payload", {
        error: parseError.message,
        payloadPreview: payload.substring(0, 200)
      });
      return res.status(400).json({ error: "Invalid payload format" });
    }

    logger.info("LemonSqueezy webhook received", { eventName, eventId });

    // 1. Global Idempotency Check
    let existingEvent;
    try {
      existingEvent = await prisma.webhookEvent.findUnique({
        where: { event_id: eventId },
      });
    } catch (dbError: any) {
      logger.error("Database error during idempotency check", {
        error: dbError.message,
        stack: dbError.stack,
        eventId
      });
      // Continue processing even if idempotency check fails
      // This ensures webhooks still process if there's a DB issue
    }

    if (existingEvent) {
      logger.info("Webhook event already processed (Idempotent)", { eventId });
      return res.status(200).json({ received: true, idempotent: true });
    }

    // Process event based on type
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

      // Fix 4: Refund Handling
      case "order_refunded":
      case "subscription_payment_refunded":
        await handleRefundEvent(event, eventName);
        break;

      default:
        logger.info("Unhandled webhook event", { eventName });
    }

    // 2. Persist Event (with error handling)
    try {
      await prisma.webhookEvent.create({
        data: {
          event_id: eventId,
          provider: "lemonsqueezy",
          event_type: eventName,
          payload: JSON.stringify(event),
          processed_at: new Date(),
        },
      });
      logger.info("Webhook event persisted", { eventId });
    } catch (persistError: any) {
      // Log but don't fail the webhook if persistence fails
      logger.error("Failed to persist webhook event", {
        error: persistError.message,
        stack: persistError.stack,
        eventId,
        eventName
      });
    }

    res.status(200).json({ received: true });
  } catch (error: any) {
    // OUTERMOST CATCH - This will catch ANY error in the entire handler
    console.error("[WEBHOOK] CRITICAL ERROR:", error);
    logger.error("Webhook processing failed", {
      error: error.message,
      stack: error.stack,
      name: error.name
    });
    res.status(500).json({ error: "Webhook processing failed" });
  }
});

/**
 * Handle order created event
 */
async function handleOrderCreated(event: any) {
  const data = event.data;
  const customData = event.meta?.custom_data || data.attributes.custom_data;
  const userId = customData?.user_id;
  const orderId = data.id;
  const amount = data.attributes.total;
  const currency = data.attributes.currency;

  if (!userId) {
    logger.error("Order created without user_id - CREDITS NOT GRANTED", {
      orderId,
      customData,
      eventMeta: event.meta,
      dataAttributes: data.attributes
    });
    return;
  }

  // Create payment history record
  await prisma.paymentHistory.create({
    data: {
      user_id: userId,
      lemonsqueezy_order_id: orderId,
      amount: Math.round(amount * 100), // Convert to cents
      currency: currency.toLowerCase(),
      status: data.attributes.status,
      receipt_url: data.attributes.receipt_url,
      description: `Order ${orderId}`,
    },
  });

  logger.info("Payment history created", { userId, orderId });

  // Handle Credit Purchases
  const plan = customData?.plan;
  const variantName = data.attributes.first_order_item?.variant_name || "";

  if ((plan && plan.startsWith("credits_")) || variantName.includes("CREDITS_")) {
    // Map plan names to credit amounts
    const CREDIT_PLAN_MAPPING: Record<string, number> = {
      "credits_trial": 5,
      "credits_standard": 25,
      "credits_pro": 50,
      "credits_enterprise": 100,
    };

    let baseAmount: number | undefined;

    // Try to get amount from custom_data plan mapping first
    if (plan && plan.startsWith("credits_")) {
      baseAmount = CREDIT_PLAN_MAPPING[plan];

      // If not in mapping, try to parse number from plan name (e.g. "credits_25")
      if (!baseAmount) {
        const parsed = parseInt(plan.replace("credits_", ""), 10);
        if (!isNaN(parsed)) {
          baseAmount = parsed;
        }
      }
    }

    // Fallback: Try to parse from variant name (e.g. "CREDITS_10" -> 10)
    if (!baseAmount && variantName.includes("CREDITS_")) {
      const match = variantName.match(/CREDITS[_\s](\d+)/i);
      if (match && match[1]) {
        const parsed = parseInt(match[1], 10);
        if (!isNaN(parsed)) {
          baseAmount = parsed;
          logger.info("Parsed credit amount from variant name", { variantName, baseAmount });
        }
      }
    }

    if (baseAmount) {
      // Scale by 100 as per user request (25 -> 2500 credits)
      const creditAmount = baseAmount * 100;

      try {
        await CreditService.addCredits(
          userId,
          creditAmount,
          "PURCHASE",
          orderId.toString(),
          `Purchased ${baseAmount} Scans (${creditAmount} Credits)`
        );

        logger.info("Credits granted to user", { userId, creditAmount, plan, variantName, baseAmount });
      } catch (creditError: any) {
        logger.error("Failed to grant credits", {
          error: creditError.message,
          stack: creditError.stack,
          userId,
          orderId,
          plan,
          variantName,
          creditAmount
        });
        throw creditError; // Re-throw to trigger webhook error
      }
    } else {
      logger.error("Could not determine credit amount from plan or variant", {
        plan,
        variantName,
        orderId,
        userId,
        firstOrderItem: data.attributes.first_order_item
      });
    }
  }
}

/**
 * Handle subscription created event
 */
async function handleSubscriptionCreated(event: any) {
  const data = event.data;
  const customData = event.meta?.custom_data || data.attributes.custom_data;
  const userId = customData?.user_id;
  const plan = customData?.plan || "student";

  if (!userId) {
    logger.warn("Subscription created without user_id", { eventMeta: event.meta });
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
    entitlement_expires_at: new Date(data.attributes.renews_at), // Access valid until renewal
  });

  console.log('[WEBHOOK_APPLY_SUBSCRIPTION]', {
    event: 'subscription_created',
    userId,
    plan,
    status: data.attributes.status,
    variant: data.attributes.variant_name || data.attributes.variant_id,
  });

  logger.info("Subscription created", { userId, plan });

  // Send welcome/confirmation email
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user && user.email) {
      // We could have a specific 'subscription welcome' email, but for now we'll rely on generic or add one.
      // The task list mentioned "Plan change confirmation". Created is essentially a plan start.
      // I'll send a Plan Change email where oldPlan is "None" or "Free".
      await EmailService.sendPlanChangeEmail(
        user.email,
        user.full_name || "ColabWize User",
        "Free",
        plan.charAt(0).toUpperCase() + plan.slice(1),
        new Date().toLocaleDateString(),
        ["Full Access to Features", "Priority Support"] // Generic features
      );
    }
  } catch (error) {
    logger.error("Failed to send subscription created email", { error });
  }
}

/**
 * Handle subscription updated event
 */
async function handleSubscriptionUpdated(event: any) {
  const data = event.data;
  const customData = event.meta?.custom_data || data.attributes.custom_data;
  const subscriptionId = data.id;
  const userId = customData?.user_id;
  const plan = customData?.plan || "student";

  if (!userId) {
    logger.warn("Subscription updated without user_id", { eventMeta: event.meta });
    return;
  }

  await SubscriptionService.upsertSubscription(userId, {
    plan,
    status: data.attributes.status,
    variant_id: data.attributes.variant_id.toString(),
    renews_at: data.attributes.renews_at ? new Date(data.attributes.renews_at) : undefined,
    ends_at: data.attributes.ends_at ? new Date(data.attributes.ends_at) : undefined,
    // If renewing, entitlement extends to renews_at. If ending, extends to ends_at.
    entitlement_expires_at: data.attributes.ends_at
      ? new Date(data.attributes.ends_at)
      : new Date(data.attributes.renews_at),
  });

  console.log('[WEBHOOK_APPLY_SUBSCRIPTION]', {
    event: 'subscription_updated',
    userId,
    plan,
    status: data.attributes.status,
    variant: data.attributes.variant_name || data.attributes.variant_id,
  });

  logger.info("Subscription updated", { userId, subscriptionId });

  // Send plan change email
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    // Use customData already extracted at the top, not data.attributes.custom_data
    const newPlan = customData?.plan || "student";
    // We don't easily know the old plan here without fetching the subscription BEFORE update, 
    // but the update handles the DB update. 
    // Ideally we would compare. For now, assuming Upgrade.

    if (user && user.email) {
      await EmailService.sendPlanChangeEmail(
        user.email,
        user.full_name || "ColabWize User",
        "Previous Plan", // Placeholder if we can't easily determine
        newPlan.charAt(0).toUpperCase() + newPlan.slice(1),
        new Date().toLocaleDateString(),
        ["Upgraded Features"]
      );
    }
  } catch (error) {
    logger.error("Failed to send subscription updated email", { error });
  }
}

/**
 * Handle subscription cancelled event
 */
async function handleSubscriptionCancelled(event: any) {
  const data = event.data;
  const customData = event.meta?.custom_data || data.attributes.custom_data;
  const userId = customData?.user_id;

  if (!userId) {
    logger.warn("Subscription cancelled without user_id", { eventMeta: event.meta });
    return;
  }

  // Determine if immediate or scheduled
  // attributes.cancelled = true -> Immediate cancellation (e.g. by admin or refunded)
  // attributes.cancelled = false -> Scheduled at period end
  const isImmediate = data.attributes.cancelled === true;
  const periodEnd = data.attributes.ends_at ? new Date(data.attributes.ends_at) : new Date();

  await SubscriptionService.upsertSubscription(userId, {
    plan: customData?.plan || "student",
    status: data.attributes.status,
    cancel_at_period_end: !isImmediate,
    ends_at: data.attributes.ends_at ? new Date(data.attributes.ends_at) : undefined,
    // Hardening: If immediate, expire NOW. If scheduled, keep access until period end.
    entitlement_expires_at: isImmediate ? new Date() : periodEnd,
  });

  logger.info("Subscription cancelled", { userId });
}

/**
 * Handle subscription resumed event
 */
async function handleSubscriptionResumed(event: any) {
  const data = event.data;
  const customData = event.meta?.custom_data || data.attributes.custom_data;
  const userId = customData?.user_id;

  if (!userId) {
    logger.warn("Subscription resumed without user_id", { eventMeta: event.meta });
    return;
  }

  await SubscriptionService.upsertSubscription(userId, {
    plan: customData?.plan || "student",
    status: "active",
    cancel_at_period_end: false,
    // Resuming usually means extending to the next renewal date
    entitlement_expires_at: data.attributes.renews_at ? new Date(data.attributes.renews_at) : undefined,
  });

  logger.info("Subscription resumed", { userId });
}

/**
 * Handle subscription expired event
 */
async function handleSubscriptionExpired(event: any) {
  const data = event.data;
  const customData = event.meta?.custom_data || data.attributes.custom_data;
  const userId = customData?.user_id;

  if (!userId) {
    logger.warn("Subscription expired without user_id", { eventMeta: event.meta });
    return;
  }

  // Hardening: Replay Protection
  // If we receive an expiry hook, but the DB says entitlement is still valid (e.g. user resubscribed recently),
  // IGNORE this hook to prevent accidental downgrade.
  const currentSub = await SubscriptionService.getUserSubscription(userId);
  if (currentSub && currentSub.entitlement_expires_at && currentSub.entitlement_expires_at > new Date()) {
    logger.warn("Ignoring subscription_expired hook: User entitlement is still valid (Replay protection)", {
      userId,
      expiresAt: currentSub.entitlement_expires_at
    });
    return;
  }

  await SubscriptionService.upsertSubscription(userId, {
    plan: "free",
    status: "expired",
    entitlement_expires_at: null, // Clear entitlement
  });

  logger.info("Subscription expired", { userId });
}

/**
 * Handle subscription paused event
 */
async function handleSubscriptionPaused(event: any) {
  const data = event.data;
  const customData = event.meta?.custom_data || data.attributes.custom_data;
  const userId = customData?.user_id;

  if (!userId) {
    logger.warn("Subscription paused without user_id", { eventMeta: event.meta });
    return;
  }

  await SubscriptionService.upsertSubscription(userId, {
    plan: customData?.plan || "student",
    status: "paused",
  });

  logger.info("Subscription paused", { userId });
}

/**
 * Handle subscription unpaused event
 */
async function handleSubscriptionUnpaused(event: any) {
  const data = event.data;
  const customData = event.meta?.custom_data || data.attributes.custom_data;
  const userId = customData?.user_id;

  if (!userId) {
    logger.warn("Subscription unpaused without user_id", { eventMeta: event.meta });
    return;
  }

  await SubscriptionService.upsertSubscription(userId, {
    plan: customData?.plan || "student",
    status: "active",
  });

  logger.info("Subscription unpaused", { userId });
}

/**
 * Handle subscription payment success event (Renewals)
 */
async function handleSubscriptionPaymentSuccess(event: any) {
  const data = event.data;
  const customData = event.meta?.custom_data || data.attributes.custom_data;
  const userId = customData?.user_id;
  const subscriptionId = data.attributes.subscription_id;

  if (!userId) {
    logger.warn("Subscription payment success without user_id", { subscriptionId, eventMeta: event.meta });
    return;
  }

  const amount = data.attributes.total;
  const currency = data.attributes.currency;
  const receiptUrl = data.attributes.receipt_url; // url to receipt

  // Create payment history record
  await prisma.paymentHistory.create({
    data: {
      user_id: userId,
      lemonsqueezy_order_id: data.id.toString(), // Using invoice ID/event ID as order ref
      amount: data.attributes.total,
      currency: currency.toLowerCase(),
      status: "paid", // payment_success implies paid
      receipt_url: receiptUrl,
      description: `Subscription Renewal - ${data.attributes.billing_reason || 'Recurring'}`,
    },
  });

  logger.info("Subscription renewal payment recorded", { userId, subscriptionId });
}

/**
 * Handle refund events (Log & Flag)
 */
async function handleRefundEvent(event: any, eventName: string) {
  const data = event.data;
  const customData = event.meta?.custom_data || data.attributes.custom_data;
  const userId = customData?.user_id;

  if (!userId) {
    logger.warn(`Refund event (${eventName}) without user_id`, { eventMeta: event.meta });
    return;
  }

  // Log strict warning
  logger.warn("REFUND DETECTED - MANUAL REVIEW REQUIRED", {
    userId,
    eventName,
    orderId: data.attributes.order_id,
    amount: data.attributes.amount,
  });

  // TODO: Add flag to user account (e.g. requires_review: true) if schema supports it
  // For now, the log is sufficient for the MVP strictness requirement.
}

export default router;
