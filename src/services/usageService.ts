import { prisma } from "../lib/prisma";
import logger from "../monitoring/logger";
import { SubscriptionService } from "./subscriptionService";

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

    logger.info("Usage tracked", { userId, feature, count: usage.count });

    return usage;
  }

  /**
   * Get current usage for user
   */
  static async getCurrentUsage(userId: string) {
    const { period_start, period_end } = this.getCurrentPeriod();

    const usageRecords = await prisma.usageTracking.findMany({
      where: {
        user_id: userId,
        period_start: { gte: period_start },
        period_end: { lte: period_end },
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
    // Get user's plan
    const plan = await SubscriptionService.getActivePlan(userId);
    const limits = SubscriptionService.getPlanLimits(plan);

    // Get feature limit
    const limit = limits[feature as keyof typeof limits] as number;

    if (limit === undefined) {
      return { allowed: false, current: 0, limit: 0 };
    }

    if (limit === Infinity) {
      return { allowed: true, current: 0, limit: Infinity };
    }

    // Get current usage
    const usage = await this.getCurrentUsage(userId);
    const current = usage[feature] || 0;

    const allowed = current < limit;

    return { allowed, current, limit };
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
