import { prisma } from "../lib/prisma";
import logger from "../monitoring/logger";

export interface AnalyticsEvent {
  userId: string;
  projectId?: string;
  eventType: "feature_usage" | "user_journey" | "conversion" | "engagement";
  eventName: string;
  eventData?: Record<string, any>;
  sessionId?: string;
}

export class AnalyticsService {
  /**
   * Track an analytics event
   */
  static async trackEvent(event: AnalyticsEvent): Promise<void> {
    try {
      await prisma.$executeRaw`
        INSERT INTO analytics_events (user_id, project_id, event_type, event_name, event_data, session_id)
        VALUES (${event.userId}, ${event.projectId || null}, ${event.eventType}, ${event.eventName}, ${JSON.stringify(event.eventData || {})}, ${event.sessionId || null})
      `;

      // Update user metrics
      await this.updateUserMetrics(event);

      logger.info("Analytics event tracked", {
        userId: event.userId,
        eventName: event.eventName,
      });
    } catch (error: any) {
      logger.error("Error tracking analytics event", {
        error: error.message,
        event,
      });
      // Don't throw - analytics should never break the app
    }
  }

  /**
   * Update user metrics based on event
   */
  private static async updateUserMetrics(event: AnalyticsEvent): Promise<void> {
    try {
      const updates: Record<string, any> = {
        last_active_at: new Date(),
      };

      // Increment feature-specific counters
      switch (event.eventName) {
        case "originality_scan_completed":
          updates.originality_scans_count = { increment: 1 };
          break;
        case "citation_check_completed":
          updates.citation_checks_count = { increment: 1 };
          break;
        case "certificate_downloaded":
          updates.certificates_downloaded_count = { increment: 1 };
          break;
        case "document_uploaded":
          updates.total_documents_uploaded = { increment: 1 };
          break;
      }

      await prisma.$executeRaw`
        INSERT INTO user_metrics (user_id, ${Object.keys(updates).join(", ")})
        VALUES (${event.userId}, ${Object.values(updates).join(", ")})
        ON CONFLICT (user_id) DO UPDATE SET
          ${Object.keys(updates)
          .map((key) => `${key} = EXCLUDED.${key}`)
          .join(", ")}
      `;
    } catch (error: any) {
      logger.error("Error updating user metrics", { error: error.message });
    }
  }

  /**
   * Get user metrics
   */
  static async getUserMetrics(userId: string): Promise<any> {
    try {
      const metrics = await prisma.$queryRaw`
        SELECT * FROM user_metrics WHERE user_id = ${userId}
      `;
      return metrics;
    } catch (error: any) {
      logger.error("Error getting user metrics", { error: error.message });
      return null;
    }
  }

  /**
   * Track feature adoption
   */
  static async trackFeatureAdoption(
    userId: string,
    featureName: string
  ): Promise<void> {
    try {
      await this.trackEvent({
        userId,
        eventType: "feature_usage",
        eventName: `${featureName}_used`,
        eventData: { feature: featureName },
      });

      // Update features_used array
      /* 
      await prisma.$executeRaw`
        UPDATE user_metrics
        SET features_used = COALESCE(features_used, '[]'::jsonb) || ${JSON.stringify([featureName])}::jsonb
        WHERE user_id = ${userId}
      `;
      */
    } catch (error: any) {
      logger.error("Error tracking feature adoption", { error: error.message });
    }
  }

  /**
   * Get analytics summary for dashboard
   */
  static async getAnalyticsSummary(userId: string): Promise<any> {
    try {
      const summary = await prisma.$queryRaw`
        SELECT 
          originality_scans_count,
          citation_checks_count,
          certificates_downloaded_count,
          total_documents_uploaded,
          total_time_spent_minutes,
          is_paid_user
        FROM user_metrics
        WHERE user_id = ${userId}
      `;

      return summary;
    } catch (error: any) {
      logger.error("Error getting analytics summary", { error: error.message });
      return null;
    }
  }

  /**
   * Track user journey step
   */
  static async trackJourneyStep(
    userId: string,
    step: "upload" | "scan" | "review" | "defend",
    projectId?: string
  ): Promise<void> {
    await this.trackEvent({
      userId,
      projectId,
      eventType: "user_journey",
      eventName: `journey_${step}`,
      eventData: { step },
    });
  }

  /**
   * Track conversion event
   */
  static async trackConversion(
    userId: string,
    conversionType: "free_to_paid" | "trial_started" | "subscription_renewed"
  ): Promise<void> {
    await this.trackEvent({
      userId,
      eventType: "conversion",
      eventName: conversionType,
    });

    if (conversionType === "free_to_paid") {
      await prisma.$executeRaw`
        UPDATE user_metrics
        SET is_paid_user = TRUE, converted_at = NOW()
        WHERE user_id = ${userId}
      `;
    }
  }

  /**
   * Get feature adoption rate
   */
  static async getFeatureAdoptionRate(): Promise<any> {
    try {
      const stats = await prisma.$queryRaw`
        SELECT 
          COUNT(DISTINCT user_id) as total_users,
          COUNT(DISTINCT CASE WHEN originality_scans_count > 0 THEN user_id END) as originality_users,
          COUNT(DISTINCT CASE WHEN citation_checks_count > 0 THEN user_id END) as citation_users,
          COUNT(DISTINCT CASE WHEN certificates_downloaded_count > 0 THEN user_id END) as certificate_users
        FROM user_metrics
      `;

      return stats;
    } catch (error: any) {
      logger.error("Error getting feature adoption rate", {
        error: error.message,
      });
      return null;
    }
  }
  /**
   * Get usage trends (documents per month)
   */
  static async getUsageTrends(
    userId: string,
    months: number = 6
  ): Promise<any[]> {
    try {
      // Calculate start date
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - months + 1);
      startDate.setDate(1); // First day of the month

      // Get count of projects created per month
      // Note: We're using raw query for date truncation which is database-specific (Postgres)
      // Fetch only the created_at dates for projects in the range
      const projects = await prisma.project.findMany({
        where: {
          user_id: userId,
          created_at: {
            gte: startDate,
          },
        },
        select: {
          created_at: true,
        },
      });

      // Group by month in memory
      const monthMap = new Map<string, number>();

      projects.forEach((p: any) => {
        const date = new Date(p.created_at);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        // Also generate the formatted name here or let frontend do it
        // Let's store by YYYY-MM and map to format
        monthMap.set(monthKey, (monthMap.get(monthKey) || 0) + 1);
      });

      // Convert map to array
      const trends = Array.from(monthMap.entries()).map(([monthKey, count]) => {
        const [year, month] = monthKey.split("-").map(Number);
        const date = new Date(year, month - 1, 1);
        return {
          month_key: monthKey,
          month_name: date.toLocaleString("default", { month: "short" }),
          count: Number(count), // Ensure it's a number
        };
      });

      return trends.sort((a, b) => a.month_key.localeCompare(b.month_key));
    } catch (error: any) {
      logger.error("Error getting usage trends", { error: error.message });
      return [];
    }
  }

  /**
   * Get yearly overview trends
   */
  static async getYearlyTrends(userId: string): Promise<any[]> {
    try {
      const projects = await prisma.project.findMany({
        where: { user_id: userId },
        select: { created_at: true },
      });

      const yearMap = new Map<number, number>();
      projects.forEach((p: any) => {
        const year = new Date(p.created_at).getFullYear();
        yearMap.set(year, (yearMap.get(year) || 0) + 1);
      });

      return Array.from(yearMap.entries())
        .map(([name, docs]) => ({ name: String(name), docs }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (error: any) {
      logger.error("Error getting yearly trends", { error: error.message });
      return [];
    }
  }

  /**
   * Get productivity insight (most productive day)
   */
  static async getProductivityInsight(userId: string): Promise<any> {
    try {
      const activities = await prisma.authorshipActivity.findMany({
        where: { user_id: userId },
        select: { session_start: true, word_count: true },
      });

      if (activities.length === 0) return null;

      const dayMap = new Map<number, number>(); // 0-6 (Sun-Sat)
      activities.forEach((a: any) => {
        const day = new Date(a.session_start).getDay();
        dayMap.set(day, (dayMap.get(day) || 0) + (a.word_count || 0));
      });

      let topDay = 0;
      let maxWords = -1;
      const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

      dayMap.forEach((words, day) => {
        if (words > maxWords) {
          maxWords = words;
          topDay = day;
        }
      });

      const totalWords = Array.from(dayMap.values()).reduce((a, b) => a + b, 0);
      const percent = totalWords > 0 ? Math.round((maxWords / totalWords) * 100) : 0;

      return {
        most_productive_day: days[topDay],
        percentage_contribution: percent,
        total_words: totalWords
      };
    } catch (error: any) {
      logger.error("Error getting productivity insight", { error: error.message });
      return null;
    }
  }

  /**
   * Get billing trends (payments per month)
   */
  static async getBillingTrends(userId: string): Promise<any[]> {
    try {
      const payments = await prisma.paymentHistory.findMany({
        where: { user_id: userId, status: "paid" },
        select: { created_at: true, amount: true },
      });

      const monthMap = new Map<string, number>();
      payments.forEach((p: any) => {
        const date = new Date(p.created_at);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        monthMap.set(key, (monthMap.get(key) || 0) + (p.amount / 100)); // Convert cents to dollars if stored as cents
      });

      return Array.from(monthMap.entries())
        .map(([monthKey, total]) => {
          const [year, month] = monthKey.split("-").map(Number);
          const date = new Date(year, month - 1, 1);
          return {
            name: date.toLocaleString("default", { month: "short" }),
            total,
            monthKey
          };
        })
        .sort((a, b) => a.monthKey.localeCompare(b.monthKey));
    } catch (error: any) {
      logger.error("Error getting billing trends", { error: error.message });
      return [];
    }
  }
}
