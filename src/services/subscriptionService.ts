import { prisma } from "../lib/prisma";
import logger from "../monitoring/logger";
import { LemonSqueezyService } from "./lemonSqueezyService";

/**
 * Plan limits and features
 */
const PLAN_LIMITS = {
  free: {
    // Scan Limits
    scans_per_month: 3,
    originality_scan: 3,
    citation_check: 0, // NOT AVAILABLE - as per pricing page
    draft_comparison: false, // NOT AVAILABLE
    rephrase_suggestions: 3,
    ai_integrity: 20,
    certificate: 10,
    max_scan_characters: 100000,

    // Feature Flags
    certificate_retention_days: 7,
    watermark: true,
    export_formats: false, // Only PDF allowed
    priority_scanning: false,
    advanced_citations: false,
    advanced_analytics: false,
  },
  payg: {
    // Scan Limits (Credit-based)
    scans_per_month: -2,
    originality_scan: -2,
    citation_check: -2,
    draft_comparison: -2,
    rephrase_suggestions: -2,
    ai_integrity: -2,
    certificate: -2,
    max_scan_characters: 300000,

    // Feature Flags
    certificate_retention_days: 0, // Immediate deletion
    watermark: false,
    export_formats: true,
    priority_scanning: false,
    advanced_citations: false,
    advanced_analytics: false,
  },
  student: {
    // Scan Limits
    scans_per_month: 50,
    originality_scan: 50,
    citation_check: 50,
    draft_comparison: false, // NOT AVAILABLE
    rephrase_suggestions: 50,
    ai_integrity: 100,
    certificate: 50,
    max_scan_characters: 300000,

    // Feature Flags
    certificate_retention_days: 30,
    watermark: false,
    export_formats: true,
    priority_scanning: false,
    advanced_citations: false,
    advanced_analytics: false,
  },
  researcher: {
    // Scan Limits (Unlimited)
    scans_per_month: -1,
    originality_scan: -1,
    citation_check: -1,
    draft_comparison: -1, // Available
    rephrase_suggestions: -1,
    ai_integrity: -1,
    certificate: -1,
    max_scan_characters: 500000,

    // Feature Flags
    certificate_retention_days: -1, // Unlimited retention
    watermark: false,
    export_formats: true,
    priority_scanning: true,
    advanced_citations: true,
    advanced_analytics: true,
  },
};

/**
 * Subscription Service
 */
export class SubscriptionService {
  /**
   * Get user's subscription
   */
  static async getUserSubscription(userId: string) {
    const subscription = await prisma.subscription.findUnique({
      where: { user_id: userId },
    });

    return subscription;
  }

  /**
   * Get active plan for user
   */
  static async getActivePlan(userId: string): Promise<string> {
    const subscription = await this.getUserSubscription(userId);

    // Allow both active and trialing statuses
    if (
      !subscription ||
      !["active", "trialing"].includes(subscription.status)
    ) {
      return "free";
    }

    return subscription.plan;
  }

  /**
   * Get plan limits
   */
  static getPlanLimits(plan: string) {
    return PLAN_LIMITS[plan as keyof typeof PLAN_LIMITS] || PLAN_LIMITS.free;
  }

  /**
   * Check feature access
   */
  static async checkFeatureAccess(
    userId: string,
    feature: string
  ): Promise<boolean> {
    const plan = await this.getActivePlan(userId);
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
    feature: string
  ): Promise<number> {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59
    );

    const usage = await prisma.usageTracking.findFirst({
      where: {
        user_id: userId,
        feature,
        period_start: periodStart,
        period_end: periodEnd,
      },
    });

    return usage?.count || 0;
  }

  /**
   * Check if user can perform an action based on feature limits
   */
  static async canPerformAction(
    userId: string,
    feature: string
  ): Promise<boolean> {
    const plan = await this.getActivePlan(userId);
    const limits = this.getPlanLimits(plan);

    // If feature not in limits (and not explicitly handled), assume allowed or denied?
    // Safe default: if keys match, check limit. If no key, maybe check feature flag.
    // Let's assume 'feature' maps to a countable limit key in PLAN_LIMITS.

    // Map high-level feature names to limit keys if needed, or assume 1:1
    // e.g. "scan" -> "scans_per_month"
    // "rephrase_suggestions" -> "rephrase_suggestions"
    let limitKey = feature;
    if (feature === "scan") limitKey = "scans_per_month";

    if (!(limitKey in limits)) {
      // If not a limit key, check if it's a boolean feature flag
      if (
        feature in limits &&
        typeof limits[feature as keyof typeof limits] === "boolean"
      ) {
        return limits[feature as keyof typeof limits] as boolean;
      }
      return true; // Unknown feature, allow or handle differently
    }

    const limit = limits[limitKey as keyof typeof limits] as number;

    // -1 = unlimited
    if (limit === -1) {
      return true;
    }

    // -2 = credit-based or unavailable
    if (limit === -2) {
      if (feature === "scan") {
        // TODO: Check credit balance for PAYG
        return true;
      }
      return false; // Unavailable for this plan
    }

    // Check usage
    const currentUsage = await this.checkMonthlyUsage(userId, feature);
    return currentUsage < limit;
  }

  /**
   * Check if user can perform a scan (wrapper for backward compatibility)
   */
  static async canPerformScan(userId: string): Promise<boolean> {
    return this.canPerformAction(userId, "scan");
  }

  /**
   * Increment usage counter
   */
  static async incrementUsage(userId: string, feature: string): Promise<void> {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59
    );

    await prisma.usageTracking.upsert({
      where: {
        user_id_feature_period_start: {
          user_id: userId,
          feature,
          period_start: periodStart,
        },
      },
      create: {
        user_id: userId,
        feature,
        count: 1,
        period_start: periodStart,
        period_end: periodEnd,
      },
      update: {
        count: { increment: 1 },
      },
    });

    logger.info("Usage incremented", { userId, feature });
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
    }
  ) {
    const subscription = await prisma.subscription.upsert({
      where: { user_id: userId },
      create: {
        user_id: userId,
        ...data,
      },
      update: data,
    });

    logger.info("Subscription upserted", {
      userId,
      plan: data.plan,
      status: data.status,
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
      subscription.lemonsqueezy_subscription_id
    );

    // Update in database
    await prisma.subscription.update({
      where: { user_id: userId },
      data: {
        cancel_at_period_end: true,
        status: "canceled",
      },
    });

    logger.info("Subscription canceled", { userId });

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
          "3 Rephrase Suggestions for improvement",
          "Max 100,000 characters (~15k words)",
          "Basic originality check",
          "Export to PDF/Word",
          "Watermarked certificate",
        ],
        limits: PLAN_LIMITS.free,
      },
      {
        id: "student",
        name: "Student",
        price: 4.99,
        interval: "month",
        features: [
          "50 document scans per month",
          "50 Rephrase Suggestions for improvement",
          "Max 300,000 characters (~50k words)",
          "Full originality map",
          "Citation confidence auditor",
          "Export to PDF/Word",
          "Professional certificate (no watermark)",
          "Email support",
        ],
        limits: PLAN_LIMITS.student,
        popular: true,
      },
      {
        id: "researcher",
        name: "Researcher",
        price: 12.99,
        interval: "month",
        features: [
          "Unlimited document scans",
          "Unlimited Rephrase Suggestions for improvement",
          "Max 500,000 characters (~80k words)",
          "Everything in Student plan",
          "Priority scanning",
          "Advanced citation suggestions",
          "Draft comparison",
          "Safe AI Integrity Assistant",
          "Export to multiple formats",
          "Priority support",
        ],
        limits: PLAN_LIMITS.researcher,
      },
    ];
  }
}
