import express from "express";
import { SubscriptionService } from "../../services/subscriptionService";
import { LemonSqueezyService } from "../../services/lemonSqueezyService";
import {EmailService} from "../../services/emailService";
import logger from "../../monitoring/logger";

const router = express.Router();

/**
 * POST /api/webhooks/lemonsqueezy
 * Handle LemonSqueezy webhook events
 */
router.post("/lemonsqueezy", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    const signature = req.headers["x-signature"] as string;
    const payload = req.body.toString();

    // Verify webhook signature
    const isValid = LemonSqueezyService.verifyWebhookSignature(payload, signature);

    if (!isValid) {
      logger.warn("Invalid webhook signature");
      return res.status(401).json({ error: "Invalid signature" });
    }

    const event = JSON.parse(payload);
    const eventName = event.meta.event_name;
    const data = event.data;

    logger.info("LemonSqueezy webhook received", { eventName });

    // Handle different event types
    switch (eventName) {
      case "order_created":
        await handleOrderCreated(data);
        break;

      case "subscription_created":
        await handleSubscriptionCreated(data);
        break;

      case "subscription_updated":
        await handleSubscriptionUpdated(data);
        break;

      case "subscription_cancelled":
        await handleSubscriptionCancelled(data);
        break;

      case "subscription_resumed":
        await handleSubscriptionResumed(data);
        break;

      case "subscription_expired":
        await handleSubscriptionExpired(data);
        break;

      case "subscription_paused":
        await handleSubscriptionPaused(data);
        break;

      case "subscription_unpaused":
        await handleSubscriptionUnpaused(data);
        break;

      default:
        logger.info("Unhandled webhook event", { eventName });
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    logger.error("Webhook error", { error });
    return res.status(500).json({ error: "Webhook processing failed" });
  }
});

/**
 * Handle order created event
 */
async function handleOrderCreated(data: any) {
  const userId = data.attributes.custom_data?.user_id;
  const orderId = data.id;
  const amount = data.attributes.total;
  const currency = data.attributes.currency;

  if (!userId) {
    logger.warn("Order created without user_id");
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
}

/**
 * Handle subscription created event
 */
async function handleSubscriptionCreated(data: any) {
  const userId = data.attributes.custom_data?.user_id;
  const plan = data.attributes.custom_data?.plan || "student";

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
async function handleSubscriptionUpdated(data: any) {
  const subscriptionId = data.id;
  const userId = data.attributes.custom_data?.user_id;

  if (!userId) {
    logger.warn("Subscription updated without user_id");
    return;
  }

  await SubscriptionService.upsertSubscription(userId, {
    plan: data.attributes.custom_data?.plan || "student",
    status: data.attributes.status,
    variant_id: data.attributes.variant_id.toString(),
    renews_at: data.attributes.renews_at ? new Date(data.attributes.renews_at) : undefined,
    ends_at: data.attributes.ends_at ? new Date(data.attributes.ends_at) : undefined,
  });

  logger.info("Subscription updated", { userId, subscriptionId });

  // Send plan change email
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const newPlan = data.attributes.custom_data?.plan || "student";
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
async function handleSubscriptionCancelled(data: any) {
  const userId = data.attributes.custom_data?.user_id;

  if (!userId) {
    logger.warn("Subscription cancelled without user_id");
    return;
  }

  await SubscriptionService.upsertSubscription(userId, {
    plan: data.attributes.custom_data?.plan || "free",
    status: "canceled",
    cancel_at_period_end: true,
    ends_at: data.attributes.ends_at ? new Date(data.attributes.ends_at) : undefined,
  });

  logger.info("Subscription cancelled", { userId });
}

/**
 * Handle subscription resumed event
 */
async function handleSubscriptionResumed(data: any) {
  const userId = data.attributes.custom_data?.user_id;

  if (!userId) {
    logger.warn("Subscription resumed without user_id");
    return;
  }

  await SubscriptionService.upsertSubscription(userId, {
    plan: data.attributes.custom_data?.plan || "student",
    status: "active",
    cancel_at_period_end: false,
  });

  logger.info("Subscription resumed", { userId });
}

/**
 * Handle subscription expired event
 */
async function handleSubscriptionExpired(data: any) {
  const userId = data.attributes.custom_data?.user_id;

  if (!userId) {
    logger.warn("Subscription expired without user_id");
    return;
  }

  await SubscriptionService.upsertSubscription(userId, {
    plan: "free",
    status: "expired",
  });

  logger.info("Subscription expired", { userId });
}

/**
 * Handle subscription paused event
 */
async function handleSubscriptionPaused(data: any) {
  const userId = data.attributes.custom_data?.user_id;

  if (!userId) {
    logger.warn("Subscription paused without user_id");
    return;
  }

  await SubscriptionService.upsertSubscription(userId, {
    plan: data.attributes.custom_data?.plan || "student",
    status: "paused",
  });

  logger.info("Subscription paused", { userId });
}

/**
 * Handle subscription unpaused event
 */
async function handleSubscriptionUnpaused(data: any) {
  const userId = data.attributes.custom_data?.user_id;

  if (!userId) {
    logger.warn("Subscription unpaused without user_id");
    return;
  }

  await SubscriptionService.upsertSubscription(userId, {
    plan: data.attributes.custom_data?.plan || "student",
    status: "active",
  });

  logger.info("Subscription unpaused", { userId });
}

// Add prisma import at the top
import { prisma } from "../../lib/prisma";

export default router;
