import { prisma } from "../lib/prisma";
import logger from "../monitoring/logger";
import { ActivityTrackingService } from "./activityTrackingService";

export interface RealTimeActivityData {
  projectId: string;
  userId: string;
  eventType:
    | "keystroke"
    | "edit"
    | "paste"
    | "copy"
    | "selection-change"
    | "session-start"
    | "session-end"
    | "backspace"
    | "delete"
    | "format"
    | "insert";
  timestamp: Date;
  contentChange?: {
    before: string;
    after: string;
    position: number;
  };
  keystrokes?: number;
  aiAssisted?: boolean;
  aiModelUsed?: string;
  sessionType?: "writing" | "editing" | "reviewing" | "ai-assisted";
  idleTime?: number;
  activeTime?: number;
  wordCount?: number;
  selectionLength?: number;
  editType?:
    | "insertion"
    | "deletion"
    | "modification"
    | "formatting"
    | "replacement";
  operationSize?: number;
  sessionId?: string;
}

export interface WritingPatternMetrics {
  typingSpeed: number; // Characters per minute
  pauseFrequency: number; // Pauses per minute
  backspaceRate: number; // Backspace usage percentage
  editingDepth: number; // How deeply content is modified
  writingContinuity: number; // How continuous the writing is
  cognitiveLoad: number; // Estimated cognitive load based on writing patterns
}

export class RealTimeAuthorshipTrackingService {
  private static readonly IDLE_THRESHOLD_MS = 300000; // 5 minutes of inactivity is considered idle

  /**
   * Track real-time authorship activity
   */
  static async trackActivity(activity: RealTimeActivityData): Promise<void> {
    try {
      // Store the real-time activity event
      await prisma.realTimeActivity.create({
        data: {
          project_id: activity.projectId,
          user_id: activity.userId,
          event_type: activity.eventType,
          timestamp: activity.timestamp,
          content_before: activity.contentChange?.before,
          content_after: activity.contentChange?.after,
          cursor_position: activity.contentChange?.position,
          keystrokes: activity.keystrokes || 0,
          ai_assisted: activity.aiAssisted || false,
          ai_model_used: activity.aiModelUsed,
          session_type: activity.sessionType || "writing",
          idle_time: activity.idleTime || 0,
          active_time: activity.activeTime || 0,
          word_count: activity.wordCount || 0,
          selection_length: activity.selectionLength || 0,
          edit_type: activity.editType,
          operation_size: activity.operationSize || 0,
          session_id: activity.sessionId,
        },
      });

      logger.info("Real-time activity tracked", {
        projectId: activity.projectId,
        userId: activity.userId,
        eventType: activity.eventType,
        timestamp: activity.timestamp,
      });
    } catch (error: any) {
      logger.error("Error tracking real-time activity", {
        error: error.message,
        projectId: activity.projectId,
      });
      throw new Error(`Failed to track real-time activity: ${error.message}`);
    }
  }

  /**
   * Calculate writing pattern metrics from recent activity
   */
  static async calculateWritingPatterns(
    projectId: string,
    userId: string,
    timeWindowMinutes: number = 60
  ): Promise<WritingPatternMetrics> {
    try {
      const cutoffTime = new Date(Date.now() - timeWindowMinutes * 60 * 1000);

      const activities = await prisma.realTimeActivity.findMany({
        where: {
          project_id: projectId,
          user_id: userId,
          timestamp: {
            gte: cutoffTime,
          },
          event_type: {
            in: ["keystroke", "edit"],
          },
        },
        orderBy: {
          timestamp: "asc",
        },
      });

      if (activities.length === 0) {
        return {
          typingSpeed: 0,
          pauseFrequency: 0,
          backspaceRate: 0,
          editingDepth: 0,
          writingContinuity: 0,
          cognitiveLoad: 0,
        };
      }

      // Calculate metrics
      const durationMs =
        activities[activities.length - 1].timestamp.getTime() -
        activities[0].timestamp.getTime();
      const durationMinutes = Math.max(0.01, durationMs / (1000 * 60)); // Avoid division by zero

      // Typing speed (characters per minute)
      const totalKeystrokes = activities.reduce(
        (sum: number, a: any) => sum + (a.keystrokes || 0),
        0
      );
      const typingSpeed = totalKeystrokes / durationMinutes;

      // Pause frequency (pauses longer than 5 seconds per minute)
      let pauseCount = 0;
      for (let i = 1; i < activities.length; i++) {
        const timeDiff =
          activities[i].timestamp.getTime() -
          activities[i - 1].timestamp.getTime();
        if (timeDiff > 5000) {
          // More than 5 seconds between events
          pauseCount++;
        }
      }
      const pauseFrequency = pauseCount / durationMinutes;

      // Backspace rate
      const backspaceActivities = activities.filter(
        (a: any) =>
          a.content_after &&
          a.content_before &&
          a.content_after.length < a.content_before.length
      );
      const backspaceRate =
        activities.length > 0
          ? (backspaceActivities.length / activities.length) * 100
          : 0;

      // Editing depth (estimated by comparing before/after content)
      let totalChanges = 0;
      let totalLength = 0;
      activities.forEach((a: any) => {
        if (a.content_before && a.content_after) {
          totalChanges += this.calculateContentDifference(
            a.content_before,
            a.content_after
          );
          totalLength += Math.max(
            a.content_before.length,
            a.content_after.length
          );
        }
      });
      const editingDepth =
        totalLength > 0 ? (totalChanges / totalLength) * 100 : 0;

      // Writing continuity (how consistently the user writes without major interruptions)
      let continuityScore = 0;
      if (activities.length > 1) {
        const timeGaps = [];
        for (let i = 1; i < activities.length; i++) {
          const gap =
            activities[i].timestamp.getTime() -
            activities[i - 1].timestamp.getTime();
          timeGaps.push(gap);
        }
        const avgGap =
          timeGaps.reduce((a: number, b: number) => a + b, 0) / timeGaps.length;
        // Lower average gap means higher continuity (capped at 100)
        continuityScore = Math.min(100, 10000 / (avgGap + 1));
      }

      // Cognitive load (based on complexity of edits, backspace usage, pause frequency)
      const cognitiveLoad = Math.min(
        100,
        50 + // base
          editingDepth * 0.2 + // more complex edits suggest higher cognitive load
          backspaceRate * 0.1 + // more backspaces suggest thinking/reconsideration
          pauseFrequency * 2 // more pauses suggest deliberation
      );

      return {
        typingSpeed,
        pauseFrequency,
        backspaceRate,
        editingDepth,
        writingContinuity: continuityScore,
        cognitiveLoad,
      };
    } catch (error: any) {
      logger.error("Error calculating writing patterns", {
        error: error.message,
        projectId,
      });
      throw new Error(`Failed to calculate writing patterns: ${error.message}`);
    }
  }

  /**
   * Calculate content difference for editing depth
   */
  private static calculateContentDifference(
    before: string,
    after: string
  ): number {
    // Simple algorithm to calculate how much content changed
    const minLength = Math.min(before.length, after.length);
    let differences = Math.abs(before.length - after.length); // Length difference

    // Compare character-by-character up to the shorter string length
    for (let i = 0; i < minLength; i++) {
      if (before[i] !== after[i]) {
        differences++;
      }
    }

    return differences;
  }

  /**
   * Generate a comprehensive authorship authenticity report
   */
  static async generateAuthenticityReport(
    projectId: string,
    userId: string
  ): Promise<{
    authenticityScore: number;
    writingPatternConsistency: number;
    manualWorkPercentage: number;
    activeTimePercentage: number;
    cognitiveLoadAverage: number;
    writingIntensity: number;
    detailedMetrics: {
      typingPatterns: WritingPatternMetrics;
      activitySummary: Awaited<
        ReturnType<(typeof ActivityTrackingService)["getActivitySummary"]>
      >;
      timeDistribution: {
        writingTime: number;
        editingTime: number;
        reviewingTime: number;
        aiAssistedTime: number;
      };
    };
  }> {
    try {
      // Get activity summary from main tracking service
      const activitySummary = await ActivityTrackingService.getActivitySummary(
        projectId,
        userId
      );

      // Calculate writing patterns
      const writingPatterns = await this.calculateWritingPatterns(
        projectId,
        userId,
        60
      );

      // Calculate time distribution by session type
      const timeDistribution = await this.calculateTimeDistribution(
        projectId,
        userId
      );

      // Calculate authenticity score components
      const activeTimePercentage =
        activitySummary.totalTimeSpent > 0
          ? (activitySummary.totalActiveTime / activitySummary.totalTimeSpent) *
            100
          : 0;

      // Combine all metrics into a comprehensive authenticity score
      let authenticityScore = 50; // Base score

      // Active time ratio contributes positively
      authenticityScore += activeTimePercentage * 0.2;

      // Manual work percentage contributes positively
      authenticityScore += activitySummary.manualWorkPercentage * 0.3;

      // Writing pattern consistency contributes positively
      authenticityScore += activitySummary.writingPatternConsistency * 0.1;

      // Cognitive load contributes positively
      authenticityScore += activitySummary.cognitiveLoadAverage * 0.05;

      // Writing intensity within reasonable bounds contributes positively
      if (
        activitySummary.writingIntensity > 10 &&
        activitySummary.writingIntensity < 150
      ) {
        const optimalIntensity = Math.min(
          10,
          Math.abs(50 - activitySummary.writingIntensity) / 5
        );
        authenticityScore += 10 - optimalIntensity;
      }

      // Writing continuity contributes positively
      authenticityScore += writingPatterns.writingContinuity * 0.1;

      // Cap the score between 0 and 100
      authenticityScore = Math.max(0, Math.min(100, authenticityScore));

      return {
        authenticityScore,
        writingPatternConsistency: activitySummary.writingPatternConsistency,
        manualWorkPercentage: activitySummary.manualWorkPercentage,
        activeTimePercentage,
        cognitiveLoadAverage: activitySummary.cognitiveLoadAverage,
        writingIntensity: activitySummary.writingIntensity,
        detailedMetrics: {
          typingPatterns: writingPatterns,
          activitySummary,
          timeDistribution,
        },
      };
    } catch (error: any) {
      logger.error("Error generating authenticity report", {
        error: error.message,
        projectId,
      });
      throw new Error(
        `Failed to generate authenticity report: ${error.message}`
      );
    }
  }

  /**
   * Calculate time distribution by session type
   */
  private static async calculateTimeDistribution(
    projectId: string,
    userId: string
  ): Promise<{
    writingTime: number;
    editingTime: number;
    reviewingTime: number;
    aiAssistedTime: number;
  }> {
    try {
      const activities = await prisma.realTimeActivity.groupBy({
        by: ["session_type"],
        where: {
          project_id: projectId,
          user_id: userId,
        },
        _sum: {
          active_time: true,
        },
      });

      const result: any = {
        writingTime: 0,
        editingTime: 0,
        reviewingTime: 0,
        aiAssistedTime: 0,
      };

      activities.forEach((activity: any) => {
        if (activity.session_type === "writing") {
          result.writingTime = activity._sum.active_time || 0;
        } else if (activity.session_type === "editing") {
          result.editingTime = activity._sum.active_time || 0;
        } else if (activity.session_type === "reviewing") {
          result.reviewingTime = activity._sum.active_time || 0;
        } else if (activity.session_type === "ai-assisted") {
          result.aiAssistedTime = activity._sum.active_time || 0;
        }
      });

      return result;
    } catch (error: any) {
      logger.error("Error calculating time distribution", {
        error: error.message,
        projectId,
      });
      throw new Error(
        `Failed to calculate time distribution: ${error.message}`
      );
    }
  }
}
