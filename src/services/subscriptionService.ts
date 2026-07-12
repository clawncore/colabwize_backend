import { prisma } from "../lib/prisma";
import { EntitlementService } from "./EntitlementService";
import logger from "../monitoring/logger";
import { LemonSqueezyService } from "./lemonSqueezyService";
import { CreditService } from "./CreditService";

export type ConsumptionResult = {
  allowed: boolean;
  source: "PLAN" | "CREDIT" | "BLOCKED";
  remaining?: number;
  cost?: number;
  message?: string;
  code?:
    | "PLAN_LIMIT_REACHED"
    | "INSUFFICIENT_CREDITS"
    | "FEATURE_NOT_ALLOWED"
    | "SYSTEM_ERROR";
};

/**
 * Plan limits and features
 */
export const plans = {
  free: {
    // Scan Limits
    scans_per_month: 3,
    originality_scan: 0, // Request: Service not available for Free
    citation_audit: 3,
    draft_comparison: false,
    rephrase_suggestions: 3,
    paper_search: 25,
    ai_integrity: 0,
    ai_chat: 5,
    ai_web_search: 10,
    certificate: 0,
    create_project: 3,
    max_scan_characters: 20000,

    // Feature Flags
    certificate_retention_days: 7,
    watermark: true,
    export_formats: false,
    priority_scanning: false,
    advanced_citations: false,
    advanced_analytics: false,
    research_gaps: false,
    insight_map: false,

    // Publishing Platform (Phase 3): exports are disabled on Free; upgrade required.
    publish_export: 0,
  },
  payg: {
    // Scan Limits (Credit-based)
    scans_per_month: -2,
    originality_scan: -2,
    citation_audit: -2,
    draft_comparison: -2,
    rephrase_suggestions: -2,
    paper_search: -2,
    ai_integrity: -2,
    ai_chat: -2,
    ai_web_search: -2,
    certificate: -2,
    create_project: -2,
    max_scan_characters: 300000,

    // Feature Flags
    certificate_retention_days: 0,
    watermark: false,
    export_formats: true,
    priority_scanning: false,
    advanced_citations: false,
    advanced_analytics: false,
    research_gaps: false,
    insight_map: false,

    publish_export: -2, // credit-based (overflow) on PAYG
  },
  plus: {
    // Scan Limits
    scans_per_month: 25,
    originality_scan: 10, // Request: Increased to 10
    citation_audit: 25,
    draft_comparison: false,
    rephrase_suggestions: 25,
    paper_search: 100,
    ai_integrity: 25,
    ai_chat: 50,
    ai_web_search: 50,
    certificate: 25,
    create_project: 25,
    max_scan_characters: 80000,

    // Feature Flags
    certificate_retention_days: 30,
    watermark: false,
    export_formats: true,
    priority_scanning: false,
    advanced_citations: false,
    advanced_analytics: false,
    research_gaps: false,
    insight_map: false,

    publish_export: 25,
  },
  premium: {
    // Scan Limits
    scans_per_month: 100,
    originality_scan: 100, // Premium Feature
    citation_audit: 100,
    draft_comparison: 100,
    rephrase_suggestions: 100,
    paper_search: 200,
    ai_integrity: 100,
    ai_chat: 100,
    ai_web_search: 100,
    certificate: 100,
    create_project: 100,
    max_scan_characters: 200000,

    // Feature Flags
    certificate_retention_days: 90,
    watermark: false,
    export_formats: true,
    priority_scanning: true,
    advanced_citations: true,
    advanced_analytics: true,
    research_gaps: true,
    insight_map: true,

    publish_export: 100,
  },
  premium_pro: {
    // Scan Limits
    scans_per_month: 50,
    originality_scan: 25, // Intermediate
    citation_audit: 50,
    draft_comparison: 50,
    rephrase_suggestions: 50,
    paper_search: 50,
    ai_integrity: 25,
    ai_chat: 100,
    ai_web_search: 50,
    certificate: 50,
    create_project: 50,
    max_scan_characters: 150000,

    // Feature Flags
    certificate_retention_days: 60,
    watermark: false,
    export_formats: true,
    priority_scanning: true,
    advanced_citations: true,
    advanced_analytics: true,
    research_gaps: true,
    insight_map: true,

    publish_export: 50,
  },
};

/**
 * Subscription Service
 */
export class SubscriptionService {
  /**
   * Get user's subscription with strict timeout
   */
  static async getUserSubscription(userId: string) {
    return prisma.subscription.findUnique({
      where: { user_id: userId },
    });
  }

  /**
   * Get active plan for user
   * Optimized to accept optional subscription object to avoid DB calls
   */
  static async getActivePlan(
    userId: string,
    existingSubscription?: any,
  ): Promise<string> {
    const subscription =
      existingSubscription ?? (await this.getUserSubscription(userId));

    if (!subscription) {
      return "free";
    }

    // 1. Entitlement Expiry (New "Bulletproof" Check)
    // If we have an explicit expiry date, trust it above all else.
    if (subscription.entitlement_expires_at) {
      const now = new Date();
      if (now > subscription.entitlement_expires_at) {
        return "free";
      }
      return subscription.plan;
    }

    // 2. Legacy Status Check (Fallback)
    // Allow active, trialing, on_trial, and past_due (grace period)
    if (
      !["active", "trialing", "on_trial", "past_due", "cancelled"].includes(
        subscription.status,
      )
    ) {
      return "free";
    }

    return subscription.plan;
  }

  /**
   * Get plan limits
   */
  /**
   * Normalize plan ID for consistency
   */
  static normalizePlanId(plan: string): string {
    if (!plan) return "free";
    let normalizedPlan = plan.toLowerCase().trim();
    if (normalizedPlan === "plus" || normalizedPlan === "student")
      return "plus";
    if (
      normalizedPlan === "premium" ||
      normalizedPlan === "researcher" ||
      normalizedPlan === "student pro"
    )
      return "premium";

    // Log normalization for debugging
    if (normalizedPlan !== plan.toLowerCase()) {
      console.log(`[PLAN_NORMALIZATION] "${plan}" -> "${normalizedPlan}"`);
    }

    return normalizedPlan;
  }

  /**
   * Get plan limits
   */
  static getPlanLimits(plan: string) {
    const normalizedPlan = this.normalizePlanId(plan);
    const resolvedLimits =
      plans[normalizedPlan as keyof typeof plans] || plans.free;

    console.log(
      `[LIMITS_RESOLUTION] Plan: "${plan}" (Normalized: "${normalizedPlan}") -> Using limits for key: ${resolvedLimits === plans.free ? "free (fallback)" : normalizedPlan}`,
    );

    return resolvedLimits;
  }

  /**
   * Check feature access
   */
  static async checkFeatureAccess(
    userId: string,
    feature: string,
    existingSubscription?: any,
  ): Promise<boolean> {
    const plan = await this.getActivePlan(userId, existingSubscription);
    const limits = this.getPlanLimits(plan);

    // Check if feature exists in plan
    if (!(feature in limits)) {
      return false;
    }

    const featureLimit = limits[feature as keyof typeof limits];

    // If boolean feature (like priority_scanning)
    if (typeof featureLimit === "boolean") {
      return featureLimit;
    }

    return true; // Feature exists in plan
  }

  /**
   * Check current month's usage for a feature
   */
  static async checkMonthlyUsage(
    userId: string,
    feature: string,
  ): Promise<number> {
    const now = new Date();

    // Fix 3: Billing Cycle Usage Reset
    // Default to Calendar Month (Free Tier / No Sub)
    let periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    let periodEnd = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
    );

    // Try to get subscription billing cycle
    try {
      const subscription = await this.getUserSubscription(userId);
      if (
        subscription &&
        subscription.current_period_start &&
        subscription.current_period_end
      ) {
        // Use active billing period
        // We trust current_period_start from LemonSqueezy
        periodStart = new Date(subscription.current_period_start);

        // Ensure periodEnd covers the full cycle (trusting LS or deriving)
        // LS current_period_end is the renewal date.
        periodEnd = new Date(subscription.current_period_end);
      }
    } catch (e) {
      // Fallback to calendar month on error
      logger.warn(
        "Failed to fetch subscription for usage check, defaulting to calendar month",
        { userId },
      );
    }

    // Map feature to limit key to ensure consistency with PLAN_LIMITS
    let limitKey = feature;
    if (feature === "scan") limitKey = "scans_per_month";
    if (feature === "citation_check") limitKey = "citation_audit";
    if (feature === "rephrase") limitKey = "rephrase_suggestions";

    const usage = await prisma.usageTracking.findFirst({
      where: {
        user_id: userId,
        feature: limitKey,
        // We check for usage records that START on or after the period start
        // This assumes usage records are created with the correct period_start
        period_start: { gte: periodStart },
      },
    });

    // Note: The original logic looked for a specific period_start/end pair.
    // However, if the billing cycle shifts (e.g. renewal), the old record won't match.
    // The "incrementUsage" method also needs to update to align with this period calculation.

    return usage?.count || 0;
  }

  /**
   * Reset monthly usage (called by cron)
   */
  static async resetMonthlyUsage(): Promise<void> {
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    await prisma.usageTracking.deleteMany({
      where: {
        period_end: { lt: lastMonth },
      },
    });

    logger.info("Monthly usage reset completed");
  }

  /**
   * Consume an action (Plan First, Then Credits)
   * This is the main entry point for feature consumption.
   */

  /**
   * Create or update subscription
   */
  static async upsertSubscription(
    userId: string,
    data: {
      plan: string;
      status: string;
      lemonsqueezy_customer_id?: string;
      lemonsqueezy_subscription_id?: string;
      variant_id?: string;
      current_period_start?: Date;
      current_period_end?: Date;
      renews_at?: Date;
      ends_at?: Date;
      cancel_at_period_end?: boolean;
      entitlement_expires_at?: Date | null;
    },
  ) {
    const subscription = await prisma.subscription.upsert({
      where: { user_id: userId },
      create: {
        user_id: userId,
        ...data,
      },
      update: data,
    });

    // REBUILD ENTITLEMENTS ON CHANGE (ASYNC FIRE-AND-FORGET)
    // We do not await this to prevent blocking the webhook response or login flow.
    EntitlementService.rebuildEntitlements(userId).catch((err) => {
      logger.error("Failed to rebuild entitlements async", {
        userId,
        error: err.message,
      });
    });

    logger.info("Subscription upserted", {
      userId,
      plan: data.plan,
      status: data.status,
    });

    console.log("[DB_SUBSCRIPTION_WRITE]", {
      userId,
      plan: data.plan,
      status: data.status,
      ls_sub_id: data.lemonsqueezy_subscription_id,
    });

    return subscription;
  }

  /**
   * Cancel subscription at period end
   */
  static async cancelSubscription(userId: string) {
    const subscription = await this.getUserSubscription(userId);

    if (!subscription || !subscription.lemonsqueezy_subscription_id) {
      throw new Error("No active subscription found");
    }

    // Cancel in LemonSqueezy
    await LemonSqueezyService.cancelSubscription(
      subscription.lemonsqueezy_subscription_id,
    );

    // Update in database
    await prisma.subscription.update({
      where: { user_id: userId },
      data: {
        cancel_at_period_end: true,
        // CRITICAL: Do NOT set status to "canceled" here.
        // User retains access until period end.
        // Status updates to "expired" via webhook when period actually ends.
      },
    });

    logger.info("Subscription canceled", { userId });

    await EntitlementService.rebuildEntitlements(userId);
    return true;
  }

  /**
   * Reactivate canceled subscription
   */
  static async reactivateSubscription(userId: string) {
    const subscription = await this.getUserSubscription(userId);

    if (!subscription || !subscription.cancel_at_period_end) {
      throw new Error("No canceled subscription found");
    }

    await prisma.subscription.update({
      where: { user_id: userId },
      data: {
        cancel_at_period_end: false,
        status: "active",
      },
    });

    logger.info("Subscription reactivated", { userId });

    await EntitlementService.rebuildEntitlements(userId);
    return true;
  }

  /**
   * Get all available plans
   */
  static getAvailablePlans() {
    return [
      {
        id: "free",
        name: "Free",
        price: 0,
        interval: "month",
        features: [
          "3 document scans per month",
          "3 Rephrase Suggestions",
          "No Originality Checks",
          "Max 20,000 characters (~3k words)",
          "Export to PDF/Word",
          "Watermarked certificate",
        ],
        limits: plans.free,
      },
      {
        id: "plus",
        name: "Plus",
        price: 5.99,
        interval: "month",
        features: [
          "25 document scans per month",
          "10 Originality Scans (Limited)",
          "50 Paper Searches",
          "Max 80,000 characters (~13k words)",
          "Citation confidence auditor",
          "Export to PDF/Word",
          "Professional certificate (no watermark)",
          "Email support",
        ],
        limits: plans.plus,
        popular: true,
      },
      {
        id: "premium",
        name: "Premium",
        price: 12.99,
        interval: "month",
        features: [
          "100 document scans per month",
          "100 Originality Scans (Premium)",
          "Max 200,000 characters (~33k words)",
          "Priority scanning",
          "Advanced citation suggestions",
          "Draft comparison",
          "Safe AI Integrity Assistant",
          "Export to multiple formats",
          "Priority support",
        ],
        limits: plans.premium,
      },
    ];
  }

  /**
   * Ensure user has a Lemon Squeezy customer ID
   * Creates one silently if missing
   */
  static async ensureLemonCustomer(user: {
    id: string;
    email: string;
    name?: string | null;
  }): Promise<string> {
    try {
      // 1. Get current subscription
      const subscription = await this.getUserSubscription(user.id);

      // 2. If already has customer ID, return it
      if (subscription?.lemonsqueezy_customer_id) {
        return subscription.lemonsqueezy_customer_id;
      }

      // 3. Check if customer already exists in Lemon Squeezy by email
      logger.info("Checking for existing Lemon Squeezy customer by email", {
        email: user.email,
      });
      const existingCustomers = await LemonSqueezyService.getCustomersByEmail(
        user.email,
      );

      let customerId: string;

      if (existingCustomers && existingCustomers.length > 0) {
        customerId = existingCustomers[0].id;
        logger.info("Found existing Lemon Squeezy customer", {
          email: user.email,
          customerId,
        });
      } else {
        // 4. Create new customer in Lemon Squeezy
        logger.info("Initializing new Lemon Squeezy customer for user", {
          userId: user.id,
        });

        const newCustomer = await LemonSqueezyService.createCustomer(
          user.email,
          user.name || "Customer",
        );
        customerId = newCustomer.id;
      }

      // 5. Update/Create subscription record with customer ID
      // CAUTION: Only set defaults if subscription is truly missing, not if it timed out
      if (subscription === null) {
        // Check if user exists first to satisfy FK
        const userExists = await prisma.user.findUnique({
          where: { id: user.id },
        });
        if (!userExists) throw new Error("User does not exist");
      }

      await this.upsertSubscription(user.id, {
        plan: subscription?.plan || "free",
        status: subscription?.status || "active", // Default to active for free plan
        lemonsqueezy_customer_id: customerId,
        // Preserve existing fields
        lemonsqueezy_subscription_id:
          subscription?.lemonsqueezy_subscription_id,
        variant_id: subscription?.variant_id,
        current_period_start: subscription?.current_period_start,
        current_period_end: subscription?.current_period_end,
      });

      logger.info("Linked Lemon Squeezy customer successfully", {
        userId: user.id,
        customerId,
      });

      return customerId;
    } catch (error) {
      logger.error("Failed to ensure Lemon Squeezy customer:", error);
      // If it's a timeout error from getUserSubscription, we should probably not throw but return gracefully or handle it
      throw error;
    }
  }

  /**
   * Update Auto-Use Credits Preference
   */
  static async updateAutoUseCredits(
    userId: string,
    enabled: boolean,
  ): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { auto_use_credits: enabled },
    });
  }
}
