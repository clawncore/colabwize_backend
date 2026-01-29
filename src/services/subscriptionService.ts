import { prisma } from "../lib/prisma";
import { EntitlementService } from "./EntitlementService";
import logger from "../monitoring/logger";
import { LemonSqueezyService } from "./lemonSqueezyService";
import { CreditService, CREDIT_COSTS } from "./CreditService";

export type ConsumptionResult = {
  allowed: boolean;
  source: "PLAN" | "CREDIT" | "BLOCKED";
  remaining?: number;
  cost?: number;
  message?: string;
  code?: "PLAN_LIMIT_REACHED" | "INSUFFICIENT_CREDITS" | "FEATURE_NOT_ALLOWED" | "SYSTEM_ERROR";
};

/**
 * Plan limits and features
 */
const PLAN_LIMITS = {
  free: {
    // Scan Limits
    scans_per_month: 3,
    originality_scan: 3,
    citation_audit: 3,
    draft_comparison: false,
    rephrase_suggestions: 3,
    paper_search: 0,
    ai_integrity: 0,
    ai_chat: 5, // Request: Limited access for Free Tier
    certificate: 0,
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
    certificate: -2,
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
  },
  student: {
    // Scan Limits
    scans_per_month: 25,
    originality_scan: 25,
    citation_audit: 25,
    draft_comparison: false,
    rephrase_suggestions: 25,
    paper_search: 25,
    ai_integrity: 0,
    ai_chat: 50, // Request: Student Limit
    certificate: 25,
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
  },
  researcher: {
    // Scan Limits
    scans_per_month: 100, // Updated to 100 as per design
    originality_scan: 100, // Match citation limit
    citation_audit: 100, // Explicitly 100 as per design
    draft_comparison: 100, // Finite limit
    rephrase_suggestions: 100, // Explicitly 100 as per design
    paper_search: 100,
    ai_integrity: 100,
    ai_chat: 100,
    certificate: 100,
    max_scan_characters: 200000, // Updated to 200k as per design

    // Feature Flags
    certificate_retention_days: 90,
    watermark: false,
    export_formats: true,
    priority_scanning: true,
    advanced_citations: true,
    advanced_analytics: true,
    research_gaps: true,
    insight_map: true,
  },
  student_pro: {
    // Scan Limits
    scans_per_month: 100,
    originality_scan: 100,
    citation_audit: 100,
    draft_comparison: 50,
    rephrase_suggestions: 100,
    paper_search: 100,
    ai_integrity: 50,
    ai_chat: 100,
    certificate: 50,
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
  static async getActivePlan(userId: string, existingSubscription?: any): Promise<string> {
    const subscription = existingSubscription ?? await this.getUserSubscription(userId);

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
    if (normalizedPlan === 'student pro') normalizedPlan = 'student_pro';
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

    // Fix 3: Billing Cycle Usage Reset
    // Default to Calendar Month (Free Tier / No Sub)
    let periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    let periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    // Try to get subscription billing cycle
    try {
      const subscription = await this.getUserSubscription(userId);
      if (subscription && subscription.current_period_start && subscription.current_period_end) {
        // Use active billing period
        // We trust current_period_start from LemonSqueezy
        periodStart = new Date(subscription.current_period_start);

        // Ensure periodEnd covers the full cycle (trusting LS or deriving)
        // LS current_period_end is the renewal date.
        periodEnd = new Date(subscription.current_period_end);
      }
    } catch (e) {
      // Fallback to calendar month on error
      logger.warn("Failed to fetch subscription for usage check, defaulting to calendar month", { userId });
    }

    const usage = await prisma.usageTracking.findFirst({
      where: {
        user_id: userId,
        feature,
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
   * Check if user can perform an action based on feature limits
   */
  /**
   * Check if user can perform an action based on feature limits
   * Canonical Rule: Subscription tier overrides scan limits.
   */
  /**
   * Check if user can perform an action based on feature limits
   * Canonical Rule: Subscription tier overrides scan limits.
   */
  /**
   * Check if user is eligible to perform an action (Dry Run)
   * Returns detailed result including blocking reason and error code.
   * @deprecated USE EntitlementService.assertCanUse() INSTEAD.
   */
  static async checkActionEligibility(
    userId: string,
    feature: string,
    metadata?: any
  ): Promise<ConsumptionResult> {
    logger.warn("DEPRECATED: SubscriptionService.checkActionEligibility called. Switch to EntitlementService.", { userId, feature });
    const plan = await this.getActivePlan(userId);
    const limits = this.getPlanLimits(plan);
    const normalizedPlan = plan.toLowerCase();

    // Map feature to limit key
    let limitKey = feature;
    if (feature === "scan") limitKey = "scans_per_month";

    let planLimit = 0;
    if (limitKey in limits) {
      const val = limits[limitKey as keyof typeof limits];
      if (typeof val === "number") planLimit = val;
    }

    // 1. Unlimited Plan
    if (planLimit === -1) {
      return { allowed: true, source: "PLAN" };
    }

    // 2. Check Plan Usage
    let planAvailable = false;
    if (planLimit > 0) {
      const currentUsage = await this.checkMonthlyUsage(userId, feature);
      if (currentUsage < planLimit) {
        planAvailable = true;
      }
    }

    if (planAvailable) {
      return { allowed: true, source: "PLAN" };
    }

    // 3. Fallback to Credits (if not allowed by plan)

    // Check if feature is "Plan Restricted" (never allowed on this plan)
    // Canonical Rule: If limit is 0, it's NOT allowed unless it's a base feature.
    const isPlanRestricted = planLimit === 0 && !["scan", "rephrase", "citation_audit"].includes(feature);

    if (isPlanRestricted) {
      return {
        allowed: false,
        source: "BLOCKED",
        code: "FEATURE_NOT_ALLOWED",
        message: "This feature is not available on your current plan."
      };
    }

    // 4. Entitlements Check (The New Truth)
    const entitlement = await EntitlementService.checkEligibility(userId, feature);
    if (entitlement.allowed) {
      return { allowed: true, source: "PLAN", remaining: entitlement.remaining };
    }

    // 5. Fallback logic for Student/Payg (already handled by logic above/below or by Entitlement check?)
    // In new architecture, Entitlements SHOULD handle the count. 
    // If Entitlements says NO, we check CREDITS.
    // The "Student Plan" Hard Block is an Entitlement Rule (no credits allowed for excess).

    // Student Plan: Hard Block if limit reached (No Pay-As-You-Go fallback)
    if (normalizedPlan === "student") {
      return {
        allowed: false,
        source: "BLOCKED",
        code: "PLAN_LIMIT_REACHED",
        message: "Monthly plan limit reached. Upgrade to Researcher for more."
      };
    }

    // Check Auto-Use Preference (for others)
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { auto_use_credits: true } });
    const autoUseEnabled = user?.auto_use_credits ?? true;

    if (!autoUseEnabled) {
      return {
        allowed: false,
        source: "BLOCKED",
        code: "PLAN_LIMIT_REACHED",
        message: "Plan limit reached. Enable Auto-Use Credits to continue."
      };
    }

    const cost = CreditService.calculateCost(feature, metadata);
    if (cost > 0) {
      const hasCredits = await CreditService.hasEnoughCredits(userId, cost);
      if (hasCredits) {
        return { allowed: true, source: "CREDIT", cost };
      } else {
        return {
          allowed: false,
          source: "BLOCKED",
          code: "INSUFFICIENT_CREDITS",
          message: "Plan limit reached and insufficient credits."
        };
      }
    }

    return {
      allowed: false,
      source: "BLOCKED",
      code: "PLAN_LIMIT_REACHED",
      message: "Plan limit reached."
    };
  }

  /**
   * Check if user can perform an action based on feature limits
   * Wrapper around checkActionEligibility for backward compatibility
   */
  static async canPerformAction(
    userId: string,
    feature: string,
    metadata?: any
  ): Promise<boolean> {
    const result = await this.checkActionEligibility(userId, feature, metadata);
    return result.allowed;
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
    // Legacy: We still track in UsageTracking for history
    const plan = await this.getActivePlan(userId);
    const limits = this.getPlanLimits(plan);

    // Map feature to limit key
    let limitKey = feature;
    if (feature === "scan") limitKey = "scans_per_month";
    if (feature === "citation_check") limitKey = "citation_audit";

    // 1. Upsert Usage Tracking (History)
    const now = new Date();
    // Default to Calendar Month logic for history consistency with internal tools
    let periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    let periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    try {
      const subscription = await this.getUserSubscription(userId);
      if (subscription && subscription.current_period_start && subscription.current_period_end) {
        periodStart = new Date(subscription.current_period_start);
        periodEnd = new Date(subscription.current_period_end);
      }
    } catch (e) {
      // Fallback
    }

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

    // 2. Consume Entitlement (The Check Gate)
    await EntitlementService.consumeEntitlement(userId, feature);

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
   * Consume an action (Plan First, Then Credits)
   * This is the main entry point for feature consumption.
   */
  static async consumeAction(
    userId: string,
    feature: string,
    metadata?: any
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

    // 4. If Plan Exhausted / Unavailable / -2 -> Check Credits (Auto-Fallback)

    // Canonical Fallback Logic
    // Rule: Credits can only be used for features allowed by the plan (or basic features available on Free tier).

    // Check if feature is "Plan Restricted" (never allowed on this plan)
    // We assume if planLimit is defined and > 0, it is allowed. 
    // If planLimit is 0 or undefined, effectively "Not Included".
    // EXCEPTION: "scan", "rephrase", "citation_audit" are generally "Base Features" available to all via credits.

    const isPlanRestricted = planLimit === 0 && !["scan", "rephrase", "citation_audit"].includes(feature);

    if (isPlanRestricted) {
      return { allowed: false, source: "BLOCKED", message: "This feature is not available on your current plan." };
    }

    // Check Auto-Use Preference
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { auto_use_credits: true } });
    const autoUseEnabled = user?.auto_use_credits ?? true; // Default True

    if (!autoUseEnabled) {
      return { allowed: false, source: "BLOCKED", message: "Plan limit reached. Enable Auto-Use Credits to continue." };
    }

    const cost = CreditService.calculateCost(feature, metadata);
    if (cost > 0) {
      // Check if user has enough credits
      const hasCredits = await CreditService.hasEnoughCredits(userId, cost);

      if (hasCredits) {
        // Deduct credits as confirmed usage
        await CreditService.deductCredits(userId, cost, undefined, `Auto-use: ${feature}`);
        return { allowed: true, source: "CREDIT", cost };
      } else {
        return { allowed: false, source: "BLOCKED", message: "You don't have enough credits." };
      }
    }

    return { allowed: false, source: "BLOCKED", message: "Plan limit reached and no credits available." };
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
      entitlement_expires_at?: Date | null;
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

    // REBUILD ENTITLEMENTS ON CHANGE (ASYNC FIRE-AND-FORGET)
    // We do not await this to prevent blocking the webhook response or login flow.
    EntitlementService.rebuildEntitlements(userId).catch(err => {
      logger.error("Failed to rebuild entitlements async", { userId, error: err.message });
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

  /**
   * Update Auto-Use Credits Preference
   */
  static async updateAutoUseCredits(userId: string, enabled: boolean): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { auto_use_credits: enabled },
    });
  }
}
