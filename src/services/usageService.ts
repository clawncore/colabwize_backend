import { prisma } from "../lib/prisma";
import logger from "../monitoring/logger";
import { SubscriptionService } from "./subscriptionService";
import { mapFeatureKey } from "../billing/BillingGateway";

/**
 * Usage Service for tracking feature usage.
 *
 * Since the BillingGateway migration, the UsageEvent ledger is the source of
 * truth for billing. This service reads from UsageEvent for current-usage
 * queries (used by the frontend dashboard) and still writes to usageTracking
 * for backwards-compatible analytics history.
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
   * Track feature usage (analytics-only).
   *
   * This writes to the legacy usageTracking table for historical analytics.
   * Billing enforcement lives in BillingGateway (UsageEvent ledger).
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

    logger.info("Usage tracked (analytics)", { userId, feature, count: usage.count });

    return usage;
  }

  /**
   * Get current usage for user.
   *
   * Reads from the UsageEvent ledger (source of truth) and maps gateway
   * feature names to the frontend-expected keys (e.g. "scan" → "scan",
   * "citation_check" → "citation_audit").
   */
  static async getCurrentUsage(userId: string, subscription?: any) {
    const now = new Date();

    // Default to Calendar Month. Build as UTC so the comparison against the
    // UTC-stored usageTracking.period_start / UsageEvent.confirmed_at columns
    // is timezone-correct. (Using `new Date(year, month, 1)` produces a
    // local-time Date; on a UTC+offset server that shifts the filter window
    // and lets the previous month's legacy rows leak into the current month.)
    let period_start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    // Try to get subscription billing cycle to align with recording logic
    try {
      if (subscription === undefined) {
        subscription = await SubscriptionService.getUserSubscription(userId);
      }

      if (subscription && subscription.current_period_start) {
        period_start = new Date(subscription.current_period_start);
      }
    } catch (e) {
      // Fallback to calendar month
    }

    // ── Primary: read from UsageEvent ledger (source of truth) ──
    let consumedEvents: { feature: string; _count: number }[] = [];
    try {
      consumedEvents = await prisma.usageEvent.groupBy({
        by: ["feature"],
        where: {
          user_id: userId,
          status: "CONSUMED",
          confirmed_at: { gte: period_start },
        },
        _count: true,
      });
    } catch (e: any) {
      // If usage_events table doesn't exist yet (migration pending), fall back
      // to usageTracking entirely.
      logger.warn("UsageEvent query failed, falling back to usageTracking", {
        error: e.message,
      });
    }

    // Map gateway feature names to frontend-expected keys.
    // The gateway stores: scan, originality_scan, citation_check, rephrase,
    // ai_chat, ai_web_search, certificate, paper_search, etc.
    // The frontend expects: scan, citation_audit, rephrase_suggestions,
    // ai_chat, originality_scan, etc.
    const featureToUsageKey: Record<string, string> = {
      scan: "scan",
      originality_scan: "scan",
      citation_audit: "citation_audit",
      citation_check: "citation_audit",
      rephrase: "rephrase_suggestions",
      ai_chat: "ai_chat",
      ai_web_search: "ai_web_search",
      certificate: "certificate",
      paper_search: "paper_search",
      create_project: "create_project",
    };

    const usage: Record<string, number> = {};
    for (const row of consumedEvents) {
      const key = featureToUsageKey[row.feature] ?? row.feature;
      usage[key] = (usage[key] ?? 0) + row._count;
    }

    // ── Fallback: merge in any usageTracking records not yet in UsageEvent ──
    // This covers pre-migration data. UsageEvent entries take precedence.
    const legacyRecords = await prisma.usageTracking.findMany({
      where: {
        user_id: userId,
        period_start: { gte: period_start },
      },
    });

    for (const record of legacyRecords) {
      if (!(record.feature in usage)) {
        usage[record.feature] = record.count;
      }
    }

    return usage;
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
