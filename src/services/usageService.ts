import { prisma } from "../lib/prisma";
import logger from "../monitoring/logger";
import { SubscriptionService } from "./subscriptionService";
import { EntitlementService } from "./EntitlementService";

/**
 * Usage Service for tracking feature usage
 */
export class UsageService {
  /**
   * Get current month period
   */
  private static getCurrentPeriod() {
    const now = new Date();
    const period_start = new Date(now.getFullYear(), now.getMonth(), 1);
    const period_end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    return { period_start, period_end };
  }

  /**
   * Track feature usage
   */
  /**
   * Track feature usage
   */
  static async trackUsage(userId: string, feature: string) {
    const { period_start, period_end } = this.getCurrentPeriod();

    const usage = await prisma.usageTracking.upsert({
      where: {
        user_id_feature_period_start: {
          user_id: userId,
          feature,
          period_start,
        },
      },
      create: {
        user_id: userId,
        feature,
        count: 1,
        period_start,
        period_end,
      },
      update: {
        count: {
          increment: 1,
        },
      },
    });

    // SYNC TO ENTITLEMENTS (Consume)
    await EntitlementService.consumeEntitlement(userId, feature);

    logger.info("Usage tracked", { userId, feature, count: usage.count });

    return usage;
  }

  /**
   * Get current usage for user
   */
  static async getCurrentUsage(userId: string) {
    const now = new Date();

    // Default to Calendar Month
    let period_start = new Date(now.getFullYear(), now.getMonth(), 1);
    // Remove strict period_end check to capture everything in the current cycle
    // or set it loosely.

    // Try to get subscription billing cycle to align with recording logic
    try {
      const subscription = await SubscriptionService.getUserSubscription(userId);
      if (subscription && subscription.current_period_start) {
        period_start = new Date(subscription.current_period_start);
      }
    } catch (e) {
      // Fallback to calendar month
    }

    const usageRecords = await prisma.usageTracking.findMany({
      where: {
        user_id: userId,
        // Only check start time. This is robust enough because we reset/rollover based on start time.
        period_start: { gte: period_start },
      },
    });

    // Convert to object for easy access
    const usage: Record<string, number> = {};
    usageRecords.forEach((record: any) => {
      usage[record.feature] = record.count;
    });

    return usage;
  }

  /**
   * Check if user can use a feature
   */
  static async checkUsageLimit(
    userId: string,
    feature: string
  ): Promise<{ allowed: boolean; current: number; limit: number }> {
    // NEW: Entitlement-Based Check
    const result = await EntitlementService.checkEligibility(userId, feature);

    // Convert to legacy return format for compatibility
    return {
      allowed: result.allowed,
      current: 0, // Deprecated/Unknown in this view, or we fetch it if needed.
      limit: result.unlimited ? -1 : (result.remaining !== undefined ? result.remaining : 0) // Approximation
    };
  }

  /**
   * Get usage history
   */
  static async getUsageHistory(userId: string, months: number = 3) {
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth() - months, 1);

    const usageRecords = await prisma.usageTracking.findMany({
      where: {
        user_id: userId,
        period_start: { gte: startDate },
      },
      orderBy: {
        period_start: "desc",
      },
    });

    return usageRecords;
  }

  /**
   * Reset monthly usage (called by cron)
   */
  static async resetMonthlyUsage() {
    const { period_start } = this.getCurrentPeriod();

    // Delete old usage records older than 6 months
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    await prisma.usageTracking.deleteMany({
      where: {
        period_end: { lt: sixMonthsAgo },
      },
    });

    logger.info("Old usage records cleaned up");

    return true;
  }
}
