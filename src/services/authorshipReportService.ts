import { prisma } from "../lib/prisma";
import logger from "../monitoring/logger";

export interface AuthorshipStats {
  projectId: string;
  userId: string;
  projectTitle: string;
  wordCount: number;

  // Time metrics
  totalTimeInvestedMinutes: number;
  firstEditDate: Date;
  lastEditDate: Date;
  activeDays: number;

  // Edit metrics
  totalSessions: number;
  manualEditsCount: number;
  totalCharacterChanges: number;
  averageEditSize: number;

  // AI transparency
  aiAssistedPercentage: number;
  aiRequestCount: number;

  // Session history
  sessionFrequency: string; // "Daily", "Weekly", etc.
  peakEditingHours: number[]; // Hours of day with most activity
}

export class AuthorshipReportService {
  /**
   * Generate comprehensive authorship statistics for a project
   */
  static async generateAuthorshipReport(
    projectId: string,
    userId: string
  ): Promise<AuthorshipStats> {
    try {
      logger.info("Generating authorship report", { projectId, userId });

      // Fetch project details
      const project = await prisma.project.findFirst({
        where: {
          id: projectId,
          user_id: userId,
        },
      });

      if (!project) {
        throw new Error("Project not found or access denied");
      }

      // Fetch all authorship activities for this project
      const activities = await prisma.authorshipActivity.findMany({
        where: { project_id: projectId },
        orderBy: { session_start: "asc" },
      });

      // Calculate AI usage strictly from project activities to ensure isolation
      // This prevents AI usage from other documents contaminating this report
      const aiRequestCount = activities.reduce(
        (sum: any, a: any) => sum + (a.ai_assisted_edits || 0),
        0
      );

      // Calculate time invested
      const timeMetrics = this.calculateTimeMetrics(activities);

      // Calculate edit statistics
      const editMetrics = this.calculateEditMetrics(activities);

      // Calculate AI transparency metrics
      const aiMetrics = this.calculateAIMetrics(
        aiRequestCount,
        project.word_count
      );

      // Compile final report
      const report: AuthorshipStats = {
        projectId: project.id,
        userId: project.user_id,
        projectTitle: project.title,
        wordCount: project.word_count,

        ...timeMetrics,
        ...editMetrics,
        ...aiMetrics,
      };

      logger.info("Authorship report generated successfully", {
        projectId,
        totalTime: report.totalTimeInvestedMinutes,
        sessions: report.totalSessions,
      });

      return report;
    } catch (error: any) {
      logger.error("Error generating authorship report", {
        error: error.message,
        projectId,
        userId,
      });
      throw new Error(`Failed to generate authorship report: ${error.message}`);
    }
  }

  /**
   * Calculate time-related metrics from activity tracking
   */
  private static calculateTimeMetrics(activities: any[]): {
    totalTimeInvestedMinutes: number;
    firstEditDate: Date;
    lastEditDate: Date;
    activeDays: number;
    sessionFrequency: string;
    peakEditingHours: number[];
  } {
    if (activities.length === 0) {
      return {
        totalTimeInvestedMinutes: 0,
        firstEditDate: new Date(),
        lastEditDate: new Date(),
        activeDays: 0,
        sessionFrequency: "N/A",
        peakEditingHours: [],
      };
    }

    const firstEdit = new Date(activities[0].session_start);
    const lastEdit = new Date(
      activities[activities.length - 1].session_end ||
        activities[activities.length - 1].session_start
    );

    // Sum up all time_spent from activities (already in seconds)
    const totalSeconds = activities.reduce(
      (sum, activity) => sum + (activity.time_spent || 0),
      0
    );
    const totalMinutes = Math.round(totalSeconds / 60);

    // Calculate active days (unique dates with activity)
    const uniqueDates = new Set(
      activities.map((a) => new Date(a.session_start).toDateString())
    );
    const activeDays = uniqueDates.size;

    // Calculate session frequency
    const daysBetween = Math.ceil(
      (lastEdit.getTime() - firstEdit.getTime()) / (1000 * 60 * 60 * 24)
    );
    let sessionFrequency = "N/A";
    if (daysBetween > 0) {
      const sessionsPerDay = activities.length / daysBetween;
      if (sessionsPerDay >= 5) sessionFrequency = "Multiple times daily";
      else if (sessionsPerDay >= 1) sessionFrequency = "Daily";
      else if (sessionsPerDay >= 0.5) sessionFrequency = "Every few days";
      else sessionFrequency = "Weekly or less";
    }

    // Find peak editing hours (hours with most sessions)
    const hourCounts: Record<number, number> = {};
    activities.forEach((a) => {
      const hour = new Date(a.session_start).getHours();
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    });

    const peakEditingHours = Object.entries(hourCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([hour]) => parseInt(hour));

    return {
      totalTimeInvestedMinutes: totalMinutes,
      firstEditDate: firstEdit,
      lastEditDate: lastEdit,
      activeDays,
      sessionFrequency,
      peakEditingHours,
    };
  }

  /**
   * Calculate edit-related metrics from activity tracking
   */
  private static calculateEditMetrics(activities: any[]): {
    totalSessions: number;
    manualEditsCount: number;
    totalCharacterChanges: number;
    averageEditSize: number;
  } {
    if (activities.length === 0) {
      return {
        totalSessions: 0,
        manualEditsCount: 0,
        totalCharacterChanges: 0,
        averageEditSize: 0,
      };
    }

    const totalSessions = activities.length;

    // Sum up edit counts from activities
    const manualEditsCount = activities.reduce(
      (sum, activity) => sum + (activity.edit_count || 0),
      0
    );

    // Sum up word count changes (approximate character changes)
    const totalCharacterChanges = activities.reduce(
      (sum, activity) => sum + (activity.word_count || 0) * 5,
      0
    ); // ~5 chars per word

    const averageEditSize =
      manualEditsCount > 0
        ? Math.round(totalCharacterChanges / manualEditsCount)
        : 0;

    return {
      totalSessions,
      manualEditsCount,
      totalCharacterChanges,
      averageEditSize,
    };
  }

  /**
   * Calculate AI assistance metrics
   */
  private static calculateAIMetrics(
    aiRequestCount: number,
    projectWordCount: number
  ): {
    aiAssistedPercentage: number;
    aiRequestCount: number;
  } {
    // Legacy object check removed since we pass number now

    // IMPORTANT: ColabWize AI is designed as an ASSISTANT, not content generator
    // Users manually write, AI helps with suggestions/improvements
    // Conservative estimate: each AI request ~= 20 words of suggestions (not 100)
    // Most suggestions are edits/improvements to existing content, not new content
    const WORDS_PER_AI_REQUEST = 20; // Conservative estimate
    const MAX_AI_PERCENTAGE = 30; // Cap at 30% to reflect reality of AI assistance

    const estimatedAIWords = aiRequestCount * WORDS_PER_AI_REQUEST;

    let aiAssistedPercentage = 0;

    if (projectWordCount > 0) {
      // Calculate percentage but cap at MAX_AI_PERCENTAGE
      aiAssistedPercentage = Math.min(
        Math.round((estimatedAIWords / projectWordCount) * 100),
        MAX_AI_PERCENTAGE
      );
    } else if (aiRequestCount > 0) {
      // Edge case: AI was used but no word count tracked
      // Show minimal percentage (5%) to be truthful
      aiAssistedPercentage = 5;
    }

    // CRITICAL VALIDATION: If word count seems unrealistic (>500k = ~1000 pages)
    // and we have manual edits, cap AI percentage more conservatively
    if (projectWordCount > 500000 && aiAssistedPercentage > 15) {
      logger.warn("Unrealistic word count detected, capping AI percentage", {
        projectWordCount,
        aiRequestCount,
        cappedPercentage: 15,
      });
      aiAssistedPercentage = Math.min(aiAssistedPercentage, 15);
    }

    return {
      aiAssistedPercentage,
      aiRequestCount,
    };
  }

  /**
   * Get AI usage data for a project within its timeframe
   */
  private static async getAIUsageForProject(userId: string, projectId: string) {
    try {
      // Get project creation date to determine which months to check
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { created_at: true, updated_at: true },
      });

      if (!project) return null;

      // Get AI usage for relevant months
      const startDate = new Date(project.created_at);
      const endDate = project.updated_at
        ? new Date(project.updated_at)
        : new Date();

      const startYear = startDate.getFullYear();
      const startMonth = startDate.getMonth() + 1;
      const endYear = endDate.getFullYear();
      const endMonth = endDate.getMonth() + 1;

      let whereClause: any = { user_id: userId };

      if (startYear === endYear) {
        // Same year
        whereClause.year = startYear;
        whereClause.month = {
          gte: startMonth,
          lte: endMonth,
        };
      } else {
        // Different years
        whereClause.OR = [
          {
            year: startYear,
            month: { gte: startMonth },
          },
          {
            year: { gt: startYear, lt: endYear },
          },
          {
            year: endYear,
            month: { lte: endMonth },
          },
        ];
      }

      const usage = await prisma.aIUsage.findMany({
        where: whereClause,
      });

      // Aggregate all usage
      const totalUsage = usage.reduce(
        (acc: any, curr: any) => ({
          request_count: acc.request_count + (curr.request_count || 0),
        }),
        { request_count: 0 }
      );

      return totalUsage;
    } catch (error) {
      logger.error("Error fetching AI usage", { error, userId, projectId });
      return null;
    }
  }

  /**
   * Get quick stats preview (lighter version for UI display)
   */
  static async getQuickStats(projectId: string, userId: string) {
    try {
      const project = await prisma.project.findFirst({
        where: { id: projectId, user_id: userId },
      });

      if (!project) {
        throw new Error("Project not found");
      }

      const activities = await prisma.authorshipActivity.findMany({
        where: { project_id: projectId },
      });

      // Sum up total time from activities
      const totalSeconds = activities.reduce(
        (sum: number, activity: any) => sum + (activity.time_spent || 0),
        0
      );
      const estimatedTimeMinutes = Math.round(totalSeconds / 60);

      return {
        wordCount: project.word_count,
        sessionCount: activities.length,
        estimatedTimeMinutes,
        lastUpdated: project.updated_at,
      };
    } catch (error: any) {
      logger.error("Error getting quick stats", {
        error: error.message,
        projectId,
      });
      throw error;
    }
  }
}
