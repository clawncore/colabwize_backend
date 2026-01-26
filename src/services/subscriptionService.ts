import { prisma } from "../lib/prisma";
import logger from "../monitoring/logger";
import { LemonSqueezyService } from "./lemonSqueezyService";
import { CreditService, CREDIT_COSTS } from "./CreditService";

export type ConsumptionResult = {
  allowed: boolean;
  source: "PLAN" | "CREDIT" | "BLOCKED";
  remaining?: number;
  cost?: number;
  message?: string;
};

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
    paper_search: 3,
    ai_integrity: 0, // Not available in Free
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
    paper_search: -2,
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
    paper_search: 50,
    ai_integrity: 0, // Not available in Student
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
    paper_search: -1,
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
   * Get user's subscription with strict timeout
   */
  static async getUserSubscription(userId: string) {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("DB_TIMEOUT")), 2000)
    );

    try {
      const subscription = await Promise.race([
        prisma.subscription.findUnique({
          where: { user_id: userId },
        }),
        timeoutPromise,
      ]);
      return subscription as any; // Cast to avoid type issues with race result
    } catch (error) {
      console.error("SubscriptionService.getUserSubscription timed out or failed:", error);
      return null;
    }
  }

  /**
   * Get active plan for user
   * Optimized to accept optional subscription object to avoid DB calls
   */
  static async getActivePlan(userId: string, existingSubscription?: any): Promise<string> {
    const subscription = existingSubscription ?? await this.getUserSubscription(userId);

    // Allow both active and trialing/on_trial statuses
    if (
      !subscription ||
      !["active", "trialing", "on_trial", "past_due"].includes(subscription.status)
    ) {
      return "free";
    }

    return subscription.plan;
  }

  /**
   * Get plan limits
   */
  /**
   * Get plan limits
   */
  static getPlanLimits(plan: string) {
    let normalizedPlan = plan.toLowerCase().trim();
    if (normalizedPlan === 'student pro') normalizedPlan = 'student';
    return PLAN_LIMITS[normalizedPlan as keyof typeof PLAN_LIMITS] || PLAN_LIMITS.free;
  }

  /**
   * Check feature access
   */
  static async checkFeatureAccess(
    userId: string,
    feature: string,
    existingSubscription?: any
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
  /**
   * Check if user can perform an action based on feature limits
   * Canonical Rule: Subscription tier overrides scan limits.
   */
  static async canPerformAction(
    userId: string,
    feature: string
  ): Promise<boolean> {
    const plan = await this.getActivePlan(userId);
    const limits = this.getPlanLimits(plan);
    const normalizedPlan = plan.toLowerCase();

    // 1. Authority Check: High-tier plans are UNLIMITED
    // If user is Researcher, they are allowed. Period.
    if (normalizedPlan === "researcher" || normalizedPlan.includes("pro")) {
      logger.info("Entitlement Check: ALLOWED (Tier Override)", { userId, feature, plan });
      return true;
    }

    // Map feature to limit key
    let limitKey = feature;
    if (feature === "scan") limitKey = "scans_per_month";

    // 2. Limit Check
    if (limitKey in limits) {
      const limit = limits[limitKey as keyof typeof limits];

      // Explicitly handle -1 as unlimited (redundant for Researcher, but safe for others)
      if (limit === -1) {
        logger.info("Entitlement Check: ALLOWED (Unlimited Limit)", { userId, feature, limit });
        return true;
      }

      // Strict Positive Limit Check
      if (typeof limit === "number" && limit > 0) {
        const currentUsage = await this.checkMonthlyUsage(userId, feature);
        if (currentUsage < limit) {
          logger.info("Entitlement Check: ALLOWED (Within Quota)", { userId, feature, currentUsage, limit });
          return true;
        }

        // If 'Student' and limit reached -> BLOCKED (No credits fallback for Student)
        if (normalizedPlan === "student") {
          logger.warn("Entitlement Check: DENIED (Quota Exceeded)", { userId, feature, currentUsage, limit, plan });
          return false;
        }
      }
    }

    // 3. Fallback: Credits (Free/PAYG only)
    const cost = CREDIT_COSTS[feature as keyof typeof CREDIT_COSTS];
    if (cost) {
      const hasCredits = await CreditService.hasEnoughCredits(userId, cost);
      logger.info(`Entitlement Check: ${hasCredits ? 'ALLOWED' : 'DENIED'} (Credits)`, { userId, feature, cost, hasCredits });
      return hasCredits;
    }

    // Default Deny
    logger.warn("Entitlement Check: DENIED (Default)", { userId, feature, plan });
    return false;
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
    const plan = await this.getActivePlan(userId);
    const limits = this.getPlanLimits(plan);

    // Map feature to limit key
    let limitKey = feature;
    if (feature === "scan") limitKey = "scans_per_month";

    let planLimit = 0;
    if (limitKey in limits) {
      const val = limits[limitKey as keyof typeof limits];
      if (typeof val === "number") planLimit = val;
    }

    // Check if we should use Plan or Credits
    let usePlan = false;

    if (planLimit === -1) {
      usePlan = true;
    } else if (planLimit > 0) {
      const currentUsage = await this.checkMonthlyUsage(userId, feature);
      if (currentUsage < planLimit) {
        usePlan = true;
      }
    }

    if (usePlan) {
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
      logger.info("Plan Usage incremented", { userId, feature });
    } else {
      // Use Credits
      const cost = CREDIT_COSTS[feature as keyof typeof CREDIT_COSTS];
      if (cost) {
        await CreditService.deductCredits(userId, cost, undefined, `Usage: ${feature}`);
        logger.info("Credit deducted for usage", { userId, feature, cost });
      } else {
        logger.warn("Usage increment passed but no plan/credit source found (cost missing?)", { userId, feature });
        // Fallback: Increment usage anyway? No, strict PAYG means we shouldn't. 
        // But if we are here, something passed the check. 
        // Let's assume unlimited or error.
      }
    }
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
  static async consumeAction(
    userId: string,
    feature: string
  ): Promise<ConsumptionResult> {
    const plan = await this.getActivePlan(userId);
    const limits = this.getPlanLimits(plan);

    // 1. Determine Plan Limit
    // Map feature to limit key (e.g., 'scan' -> 'scans_per_month')
    let limitKey = feature;
    if (feature === "scan") limitKey = "scans_per_month";

    let planLimit = 0;
    if (limitKey in limits) {
      const val = limits[limitKey as keyof typeof limits];
      if (typeof val === "number") planLimit = val;
    }

    // 2. Check Plan Usage
    // -1 = Unlimited
    if (planLimit === -1) {
      await this.incrementUsage(userId, feature);
      return { allowed: true, source: "PLAN" };
    }

    let planAvailable = false;
    if (planLimit > 0) {
      const currentUsage = await this.checkMonthlyUsage(userId, feature);
      if (currentUsage < planLimit) {
        planAvailable = true;
      }
    }

    // 3. Consume Plan if Available
    if (planAvailable) {
      await this.incrementUsage(userId, feature);
      return { allowed: true, source: "PLAN", remaining: planLimit - (await this.checkMonthlyUsage(userId, feature)) };
    }

    // 4. If Plan Exhausted / Unavailable / -2 -> Check Credits

    // STRICT RULE: Student/Researcher plans do NOT use credits as fallback.
    if (["student", "researcher", "student pro"].includes(plan.toLowerCase())) {
      return { allowed: false, source: "BLOCKED", message: "Plan limit reached. Please upgrade your plan." };
    }

    const cost = CREDIT_COSTS[feature as keyof typeof CREDIT_COSTS];
    if (!cost) {
      // If no credit cost defined, and plan failed, then it's blocked.
      return { allowed: false, source: "BLOCKED", message: "Limit reached and no credit cost defined." };
    }

    try {
      await CreditService.deductCredits(userId, cost, undefined, `Usage: ${feature}`);
      return { allowed: true, source: "CREDIT", cost };
    } catch (error) {
      return { allowed: false, source: "BLOCKED", message: "Insufficient credits." };
    }
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

    console.log('[DB_SUBSCRIPTION_WRITE]', {
      userId,
      plan: data.plan,
      status: data.status,
      ls_sub_id: data.lemonsqueezy_subscription_id
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
        // CRITICAL: Do NOT set status to "canceled" here. 
        // User retains access until period end.
        // Status updates to "expired" via webhook when period actually ends.
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
          "3 Paper Searches",
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
          "50 Paper Searches",
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

  /**
   * Ensure user has a Lemon Squeezy customer ID
   * Creates one silently if missing
   */
  static async ensureLemonCustomer(user: { id: string; email: string; name?: string | null }): Promise<string> {
    try {
      // 1. Get current subscription
      const subscription = await this.getUserSubscription(user.id);

      // 2. If already has customer ID, return it
      if (subscription?.lemonsqueezy_customer_id) {
        return subscription.lemonsqueezy_customer_id;
      }

      // 3. Check if customer already exists in Lemon Squeezy by email
      logger.info("Checking for existing Lemon Squeezy customer by email", { email: user.email });
      const existingCustomers = await LemonSqueezyService.getCustomersByEmail(user.email);

      let customerId: string;

      if (existingCustomers && existingCustomers.length > 0) {
        customerId = existingCustomers[0].id;
        logger.info("Found existing Lemon Squeezy customer", { email: user.email, customerId });
      } else {
        // 4. Create new customer in Lemon Squeezy
        logger.info("Initializing new Lemon Squeezy customer for user", { userId: user.id });

        const newCustomer = await LemonSqueezyService.createCustomer(
          user.email,
          user.name || "Customer"
        );
        customerId = newCustomer.id;
      }

      // 5. Update/Create subscription record with customer ID
      // CAUTION: Only set defaults if subscription is truly missing, not if it timed out
      if (subscription === null) {
        // Check if user exists first to satisfy FK
        const userExists = await prisma.user.findUnique({ where: { id: user.id } });
        if (!userExists) throw new Error("User does not exist");
      }

      await this.upsertSubscription(user.id, {
        plan: subscription?.plan || "free",
        status: subscription?.status || "active", // Default to active for free plan
        lemonsqueezy_customer_id: customerId,
        // Preserve existing fields
        lemonsqueezy_subscription_id: subscription?.lemonsqueezy_subscription_id,
        variant_id: subscription?.variant_id,
        current_period_start: subscription?.current_period_start,
        current_period_end: subscription?.current_period_end,
      });

      logger.info("Linked Lemon Squeezy customer successfully", {
        userId: user.id,
        customerId
      });

      return customerId;
    } catch (error) {
      logger.error("Failed to ensure Lemon Squeezy customer:", error);
      // If it's a timeout error from getUserSubscription, we should probably not throw but return gracefully or handle it
      throw error;
    }
  }
}
