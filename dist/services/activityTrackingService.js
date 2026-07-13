"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActivityTrackingService = void 0;
const prisma_1 = require("../lib/prisma");
const logger_1 = __importDefault(require("../monitoring/logger"));
class ActivityTrackingService {
    /**
     * Record authorship activity for a project
     */
    static async recordActivity(data) {
        try {
            // Check for recent activity (within last 2 minutes) to update instead of creating new
            // This prevents "double counting" where every 30s sync creates a new row with cumulative stats
            const recentActivity = await prisma_1.prisma.authorshipActivity.findFirst({
                where: {
                    project_id: data.projectId,
                    user_id: data.userId,
                    session_end: {
                        gt: new Date(Date.now() - 2 * 60 * 1000), // Active in last 2 mins
                    },
                },
                orderBy: {
                    session_end: "desc",
                },
            });
            // If we found a recent session AND the new timeSpent is greater (continuation), update it
            // If timeSpent is lower, it means the user refreshed the page (new session start), so we create new
            // Logic update: Support both Delta updates (increments) and Absolute updates (replace)
            // If we found a recent session, update it
            if (recentActivity) {
                if (data.isDelta) {
                    // DELTA LOGIC: ALWAYS increment — never drop. The old code had a
                    // guard that silently discarded deltas when timeSpent wasn't larger
                    // than the stored value, which caused the certificate to show
                    // stale/false keystroke and edit counts. Every delta represents
                    // real work that must be recorded.
                    await prisma_1.prisma.authorshipActivity.update({
                        where: { id: recentActivity.id },
                        data: {
                            time_spent: { increment: data.timeSpent },
                            edit_count: { increment: data.editCount },
                            keystrokes: { increment: data.keystrokes || 0 },
                            // word_count is absolute state, so we replace it
                            word_count: data.wordCount,
                            session_end: new Date(),
                            ai_assisted_edits: { increment: data.aiAssistedEdits || 0 },
                            manual_edits: { increment: data.manualEdits || 0 },
                        },
                    });
                }
                else {
                    // ABSOLUTE LOGIC: Replace with new values. Always write — the
                    // unmount handler sends absolute final totals that must never be
                    // silently dropped.
                    await prisma_1.prisma.authorshipActivity.update({
                        where: { id: recentActivity.id },
                        data: {
                            time_spent: data.timeSpent,
                            edit_count: data.editCount,
                            keystrokes: data.keystrokes || 0,
                            word_count: data.wordCount || 0,
                            session_end: new Date(),
                            ai_assisted_edits: data.aiAssistedEdits || 0,
                            manual_edits: data.manualEdits || 0,
                        },
                    });
                }
                logger_1.default.info("Activity session updated", {
                    projectId: data.projectId,
                    mode: data.isDelta ? "DELTA" : "ABSOLUTE",
                    id: recentActivity.id,
                });
            }
            else {
                // Create new session
                // If delta, we start with the delta values. If absolute, we start with the absolute values.
                // NOTE: If absolute and very large (e.g. 1 hour) but creating NEW session, it implies double counting risk.
                // But with isDelta=true, this risk is eliminated.
                await prisma_1.prisma.authorshipActivity.create({
                    data: {
                        project_id: data.projectId,
                        user_id: data.userId,
                        time_spent: data.timeSpent,
                        edit_count: data.editCount,
                        keystrokes: data.keystrokes || 0,
                        word_count: data.wordCount || 0,
                        session_start: data.sessionStart || new Date(),
                        session_end: data.sessionEnd || new Date(),
                        idle_time: data.idleTime || 0,
                        active_time: data.activeTime || 0,
                        ai_assisted_edits: data.aiAssistedEdits || 0,
                        manual_edits: data.manualEdits || 0,
                        writing_pattern_score: data.writingPatternScore || 0,
                        cognitive_load: data.cognitiveLoad || 0,
                        session_type: data.sessionType || "writing",
                    },
                });
            }
            logger_1.default.info("Activity recorded to database", {
                projectId: data.projectId,
                userId: data.userId,
                timeSpent: data.timeSpent,
                editCount: data.editCount,
            });
        }
        catch (error) {
            logger_1.default.error("Error recording activity", {
                error: error.message,
                projectId: data.projectId,
            });
            throw new Error(`Failed to record activity: ${error.message}`);
        }
    }
    /**
     * Get activity summary for a project
     */
    static async getActivitySummary(projectId, userId) {
        try {
            // Fetch all activities from authorship_activities table
            const activities = await prisma_1.prisma.authorshipActivity.findMany({
                where: {
                    project_id: projectId,
                    user_id: userId,
                },
                orderBy: {
                    session_start: "asc",
                },
            });
            if (activities.length === 0) {
                return {
                    totalTimeSpent: 0,
                    totalEdits: 0,
                    totalKeystrokes: 0,
                    totalSessions: 0,
                    averageSessionLength: 0,
                    firstActivity: null,
                    lastActivity: null,
                    totalActiveTime: 0,
                    totalIdleTime: 0,
                    totalManualEdits: 0,
                    totalAIAssistedEdits: 0,
                    writingPatternConsistency: 0,
                    cognitiveLoadAverage: 0,
                    writingIntensity: 0,
                    manualWorkPercentage: 0,
                    authenticityScore: 0,
                };
            }
            // Aggregate data
            const totalTimeSpent = activities.reduce((sum, a) => sum + (a.time_spent || 0), 0);
            const totalEdits = activities.reduce((sum, a) => sum + (a.edit_count || 0), 0);
            const totalKeystrokes = activities.reduce((sum, a) => sum + (a.keystrokes || 0), 0);
            const totalSessions = activities.length;
            // Calculate new metrics
            const totalActiveTime = activities.reduce((sum, a) => sum + (a.active_time || 0), 0);
            const totalIdleTime = activities.reduce((sum, a) => sum + (a.idle_time || 0), 0);
            const totalManualEdits = activities.reduce((sum, a) => sum + (a.manual_edits || 0), 0);
            const totalAIAssistedEdits = activities.reduce((sum, a) => sum + (a.ai_assisted_edits || 0), 0);
            const totalWritingPatternScore = activities.reduce((sum, a) => sum + (a.writing_pattern_score || 0), 0);
            const totalCognitiveLoad = activities.reduce((sum, a) => sum + (a.cognitive_load || 0), 0);
            const averageSessionLength = totalSessions > 0 ? Math.round(totalTimeSpent / totalSessions) : 0;
            const writingPatternConsistency = totalSessions > 0 ? totalWritingPatternScore / totalSessions : 0;
            const cognitiveLoadAverage = totalSessions > 0 ? totalCognitiveLoad / totalSessions : 0;
            const writingIntensity = totalActiveTime > 0 ? totalEdits / (totalActiveTime / 3600) : 0; // edits per hour of active time
            const manualWorkPercentage = totalEdits > 0 ? (totalManualEdits / totalEdits) * 100 : 0;
            // Create a partial summary object to calculate authenticity score
            const partialSummary = {
                totalTimeSpent,
                totalEdits,
                totalKeystrokes,
                totalSessions,
                averageSessionLength,
                firstActivity: activities[0].session_start,
                lastActivity: activities[activities.length - 1].session_end ||
                    activities[activities.length - 1].session_start,
                totalActiveTime,
                totalIdleTime,
                totalManualEdits,
                totalAIAssistedEdits,
                writingPatternConsistency,
                cognitiveLoadAverage,
                writingIntensity,
                manualWorkPercentage,
                authenticityScore: 0, // Placeholder, will be calculated below
            };
            // Calculate authenticity score based on the complete summary
            const authenticityScore = this.calculateAuthenticityScore(partialSummary);
            return {
                ...partialSummary,
                authenticityScore,
            };
        }
        catch (error) {
            logger_1.default.error("Error getting activity summary", {
                error: error.message,
                projectId,
            });
            throw new Error(`Failed to get activity summary: ${error.message}`);
        }
    }
    /**
     * Get activity statistics in format expected by frontend
     */
    static async getActivityStats(projectId, userId) {
        try {
            // Get the project title
            const project = await prisma_1.prisma.project.findUnique({
                where: { id: projectId },
                select: { title: true },
            });
            // Get all activities
            const activities = await prisma_1.prisma.authorshipActivity.findMany({
                where: {
                    project_id: projectId,
                    user_id: userId,
                },
                orderBy: {
                    session_start: "asc",
                },
            });
            if (activities.length === 0) {
                return {
                    projectId,
                    userId,
                    projectTitle: project?.title || "Untitled Project",
                    wordCount: 0,
                    totalTimeInvestedMinutes: 0,
                    firstEditDate: null,
                    lastEditDate: null,
                    activeDays: 0,
                    totalSessions: 0,
                    manualEditsCount: 0,
                    totalCharacterChanges: 0,
                    averageEditSize: 0,
                    aiAssistedPercentage: 0,
                    aiRequestCount: 0,
                    sessionFrequency: "No activity",
                    peakEditingHours: [],
                };
            }
            // Aggregate data
            const totalTimeSpentSeconds = activities.reduce((sum, a) => sum + (a.time_spent || 0), 0);
            const totalEdits = activities.reduce((sum, a) => sum + (a.edit_count || 0), 0);
            const totalKeystrokes = activities.reduce((sum, a) => sum + (a.keystrokes || 0), 0);
            const totalManualEdits = activities.reduce((sum, a) => sum + (a.manual_edits || 0), 0);
            const totalAIAssistedEdits = activities.reduce((sum, a) => sum + (a.ai_assisted_edits || 0), 0);
            // word_count is ABSOLUTE (current document state), NOT a delta — so
            // summing it across sessions would massively inflate the number.
            // Take the max, which represents the latest known document size.
            const totalWordCount = activities.reduce((max, a) => Math.max(max, a.word_count || 0), 0);
            // Calculate active days (unique dates)
            const uniqueDates = new Set(activities.map((a) => new Date(a.session_start).toISOString().split("T")[0]));
            const activeDays = uniqueDates.size;
            // Calculate AI assisted percentage
            const manualWorkPercentage = totalEdits > 0 ? (totalManualEdits / totalEdits) * 100 : 100;
            const aiAssistedPercentage = Math.max(0, 100 - manualWorkPercentage);
            // Calculate session frequency
            let sessionFrequency = "No activity";
            if (activeDays > 0) {
                const daysSpan = (new Date(activities[activities.length - 1].session_start).getTime() -
                    new Date(activities[0].session_start).getTime()) /
                    (1000 * 60 * 60 * 24) +
                    1;
                const sessionsPerDay = activities.length / daysSpan;
                if (sessionsPerDay >= 1) {
                    sessionFrequency = "Daily";
                }
                else if (sessionsPerDay >= 0.5) {
                    sessionFrequency = "Every 2 days";
                }
                else if (sessionsPerDay >= 0.33) {
                    sessionFrequency = "2-3 times per week";
                }
                else {
                    sessionFrequency = "Weekly";
                }
            }
            // Calculate peak editing hours
            const hourCounts = new Array(24).fill(0);
            activities.forEach((a) => {
                const hour = new Date(a.session_start).getHours();
                hourCounts[hour]++;
            });
            const peakEditingHours = hourCounts
                .map((count, hour) => ({ count, hour }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 3)
                .filter((item) => item.count > 0)
                .map((item) => item.hour);
            return {
                projectId,
                userId,
                projectTitle: project?.title || "Untitled Project",
                wordCount: totalWordCount,
                totalTimeInvestedMinutes: Math.round(totalTimeSpentSeconds / 60), // Convert seconds to minutes
                firstEditDate: activities[0].session_start,
                lastEditDate: activities[activities.length - 1].session_end ||
                    activities[activities.length - 1].session_start,
                activeDays,
                totalSessions: activities.length,
                manualEditsCount: totalManualEdits || totalEdits, // Fallback to totalEdits if not tracked
                totalCharacterChanges: totalKeystrokes,
                averageEditSize: totalEdits > 0 ? Math.round(totalKeystrokes / totalEdits) : 0,
                aiAssistedPercentage: Math.round(aiAssistedPercentage),
                aiRequestCount: totalAIAssistedEdits,
                sessionFrequency,
                peakEditingHours,
            };
        }
        catch (error) {
            logger_1.default.error("Error getting activity stats", {
                error: error.message,
                projectId,
            });
            throw new Error(`Failed to get activity stats: ${error.message}`);
        }
    }
    /**
     * Format time for certificate display
     */
    static formatTimeForCertificate(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        if (hours > 0) {
            return `${hours} hour${hours !== 1 ? "s" : ""} ${minutes} minute${minutes !== 1 ? "s" : ""}`;
        }
        return `${minutes} minute${minutes !== 1 ? "s" : ""}`;
    }
    /**
     * Generate statistics for authorship certificate
     */
    static async getCertificateStats(projectId, userId) {
        try {
            const summary = await this.getActivitySummary(projectId, userId);
            // Determine work intensity based on edits and time
            let workIntensity = "light";
            const editsPerHour = summary.totalTimeSpent > 0
                ? summary.totalEdits / (summary.totalTimeSpent / 3600)
                : 0;
            if (editsPerHour > 100) {
                workIntensity = "intensive";
            }
            else if (editsPerHour > 50) {
                workIntensity = "moderate";
            }
            // Determine manual work level based on authenticity score
            let manualWorkLevel = "low";
            if (summary.authenticityScore >= 80) {
                manualWorkLevel = "very-high";
            }
            else if (summary.authenticityScore >= 60) {
                manualWorkLevel = "high";
            }
            else if (summary.authenticityScore >= 40) {
                manualWorkLevel = "medium";
            }
            return {
                totalTimeSpent: this.formatTimeForCertificate(summary.totalTimeSpent),
                totalEdits: summary.totalEdits,
                totalKeystrokes: summary.totalKeystrokes,
                workIntensity,
                // New robust authorship metrics
                totalActiveTime: this.formatTimeForCertificate(summary.totalActiveTime),
                totalIdleTime: this.formatTimeForCertificate(summary.totalIdleTime),
                totalManualEdits: summary.totalManualEdits,
                totalAIAssistedEdits: summary.totalAIAssistedEdits,
                manualWorkPercentage: summary.manualWorkPercentage,
                writingPatternConsistency: summary.writingPatternConsistency,
                cognitiveLoadAverage: summary.cognitiveLoadAverage,
                writingIntensity: summary.writingIntensity,
                authenticityScore: summary.authenticityScore,
                manualWorkLevel,
            };
        }
        catch (error) {
            logger_1.default.error("Error getting certificate stats", {
                error: error.message,
                projectId,
            });
            throw new Error(`Failed to get certificate stats: ${error.message}`);
        }
    }
    /**
     * Batch record multiple activity sessions
     */
    static async batchRecordActivities(activities) {
        try {
            // Record activities in parallel
            await Promise.all(activities.map((activity) => this.recordActivity(activity)));
            logger_1.default.info("Batch activities recorded", {
                count: activities.length,
            });
        }
        catch (error) {
            logger_1.default.error("Error batch recording activities", {
                error: error.message,
            });
            throw new Error(`Failed to batch record activities: ${error.message}`);
        }
    }
    /**
     * Calculate authenticity score based on multiple activity metrics
     */
    static calculateAuthenticityScore(metrics) {
        // Base score starts at 50
        let score = 50;
        // Higher active time vs idle time increases score
        const activeRatio = metrics.totalActiveTime > 0
            ? metrics.totalActiveTime /
                (metrics.totalActiveTime + metrics.totalIdleTime || 1)
            : 0;
        score += activeRatio * 20; // Up to +20 points
        // Higher manual work percentage increases score
        score += metrics.manualWorkPercentage * 0.3; // Up to +30 points for 100% manual
        // Writing pattern consistency increases score
        score += metrics.writingPatternConsistency * 0.1; // Up to +10 points
        // Cognitive load contributes positively
        score += metrics.cognitiveLoadAverage * 0.05; // Up to +5 points
        // Writing intensity (edits per hour) within reasonable range is good
        if (metrics.writingIntensity > 0 && metrics.writingIntensity < 200) {
            // Optimal range is 20-80 edits/hour, score peaks in this range
            const intensityScore = Math.min(10, Math.abs(50 - metrics.writingIntensity) / 5);
            score += 10 - intensityScore; // Up to +10 points
        }
        // Cap the score between 0 and 100
        return Math.max(0, Math.min(100, score));
    }
    /**
     * Get detailed granular activity tracking for a project
     */
    static async getDetailedActivityTracking(projectId, userId, timeFrameDays = 30) {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - timeFrameDays);
            // Get real-time activities for detailed analysis
            const realTimeActivities = await prisma_1.prisma.realTimeActivity.findMany({
                where: {
                    project_id: projectId,
                    user_id: userId,
                    timestamp: {
                        gte: cutoffDate,
                    },
                },
                orderBy: {
                    timestamp: "asc",
                },
            });
            // Session analysis
            const sessions = new Map();
            realTimeActivities.forEach((activity) => {
                const sessionDate = activity.session_id || activity.timestamp.toISOString().split("T")[0]; // Use session_id if available, otherwise date
                if (!sessions.has(sessionDate)) {
                    sessions.set(sessionDate, []);
                }
                sessions.get(sessionDate)?.push(activity);
            });
            let totalSessionDuration = 0;
            let totalSessions = 0;
            sessions.forEach((sessionActivities) => {
                if (sessionActivities.length > 0) {
                    const start = sessionActivities[0].timestamp;
                    const end = sessionActivities[sessionActivities.length - 1].timestamp;
                    const duration = (end.getTime() - start.getTime()) / 1000; // in seconds
                    totalSessionDuration += duration;
                    totalSessions++;
                }
            });
            const avgSessionDuration = totalSessions > 0 ? totalSessionDuration / totalSessions : 0;
            const sessionFrequency = timeFrameDays > 0 ? totalSessions / timeFrameDays : 0;
            // Peak activity hours analysis
            const hourlyActivity = new Array(24).fill(0);
            realTimeActivities.forEach((activity) => {
                const hour = activity.timestamp.getHours();
                hourlyActivity[hour]++;
            });
            // Find peak hours (top 3)
            const peakActivityHours = [...hourlyActivity.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([hour, count]) => hour);
            // Edit analysis
            const editTypeCounts = {
                insertion: 0,
                deletion: 0,
                modification: 0,
                formatting: 0,
                replacement: 0,
            };
            let totalOperationSize = 0;
            let smallOps = 0, mediumOps = 0, largeOps = 0;
            realTimeActivities.forEach((activity) => {
                if (activity.edit_type) {
                    if (editTypeCounts.hasOwnProperty(activity.edit_type)) {
                        editTypeCounts[activity.edit_type]++;
                    }
                }
                if (activity.operation_size !== undefined &&
                    activity.operation_size !== null) {
                    totalOperationSize += activity.operation_size;
                    if (activity.operation_size < 10)
                        smallOps++;
                    else if (activity.operation_size <= 100)
                        mediumOps++;
                    else
                        largeOps++;
                }
            });
            const avgOperationSize = realTimeActivities.length > 0
                ? totalOperationSize / realTimeActivities.length
                : 0;
            // Behavioral patterns
            // Calculate typing patterns based on timestamps and content changes
            let totalCharsAdded = 0;
            let backspaceOperations = 0;
            let totalActiveTime = 0;
            let totalWordsAdded = 0;
            for (let i = 0; i < realTimeActivities.length; i++) {
                const activity = realTimeActivities[i];
                if (activity.content_before && activity.content_after) {
                    const beforeLen = activity.content_before.length;
                    const afterLen = activity.content_after.length;
                    if (afterLen < beforeLen) {
                        backspaceOperations++; // Count as backspace/delete operation
                    }
                    else {
                        totalCharsAdded += afterLen - beforeLen;
                    }
                }
                if (activity.active_time) {
                    totalActiveTime += activity.active_time;
                }
            }
            // Very rough word count estimation based on total inserted characters
            totalWordsAdded = Math.floor(totalCharsAdded / 5);
            const totalDurationMs = realTimeActivities.length > 1
                ? realTimeActivities[realTimeActivities.length - 1].timestamp.getTime() - realTimeActivities[0].timestamp.getTime()
                : 0;
            const totalDurationMinutes = Math.max(0.01, totalDurationMs / (1000 * 60)); // Avoid division by zero
            const avgCharactersPerMinute = totalDurationMinutes > 0 ? totalCharsAdded / totalDurationMinutes : 0;
            const avgWordsPerMinute = totalDurationMinutes > 0 ? totalWordsAdded / totalDurationMinutes : 0;
            const backspaceRate = realTimeActivities.length > 0
                ? (backspaceOperations / realTimeActivities.length) * 100
                : 0;
            const pauseFrequency = totalActiveTime > 0
                ? realTimeActivities.length / (totalActiveTime / 60)
                : 0; // Pauses per minute of active time
            // Activity distribution by session type
            const sessionTypeCounts = {};
            realTimeActivities.forEach((activity) => {
                const type = activity.session_type || "writing";
                sessionTypeCounts[type] = (sessionTypeCounts[type] || 0) + 1;
            });
            const totalActivities = realTimeActivities.length;
            const writingPercentage = totalActivities > 0
                ? ((sessionTypeCounts["writing"] || 0) / totalActivities) * 100
                : 0;
            const editingPercentage = totalActivities > 0
                ? ((sessionTypeCounts["editing"] || 0) / totalActivities) * 100
                : 0;
            const reviewingPercentage = totalActivities > 0
                ? ((sessionTypeCounts["reviewing"] || 0) / totalActivities) * 100
                : 0;
            const aiAssistedPercentage = totalActivities > 0
                ? ((sessionTypeCounts["ai-assisted"] || 0) / totalActivities) * 100
                : 0;
            // Timeline data grouped by day
            const dailyActivityMap = {};
            realTimeActivities.forEach((activity) => {
                const dateStr = activity.timestamp.toISOString().split("T")[0];
                if (!dailyActivityMap[dateStr]) {
                    dailyActivityMap[dateStr] = {
                        activityCount: 0,
                        totalDuration: 0,
                        editCount: 0,
                    };
                }
                dailyActivityMap[dateStr].activityCount++;
                if (activity.active_time) {
                    dailyActivityMap[dateStr].totalDuration += activity.active_time;
                }
                if (activity.keystrokes) {
                    dailyActivityMap[dateStr].editCount += activity.keystrokes;
                }
            });
            const timelineData = Object.entries(dailyActivityMap)
                .map(([date, data]) => ({
                date,
                activityCount: data.activityCount,
                totalDuration: data.totalDuration,
                editCount: data.editCount,
            }))
                .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
            return {
                sessionAnalysis: {
                    totalSessions,
                    avgSessionDuration,
                    sessionFrequency,
                    peakActivityHours,
                },
                editAnalysis: {
                    editTypes: editTypeCounts,
                    operationSizes: {
                        avgOperationSize,
                        smallOperations: smallOps,
                        mediumOperations: mediumOps,
                        largeOperations: largeOps,
                    },
                },
                behavioralPatterns: {
                    typingPatterns: {
                        avgWordsPerMinute,
                        avgCharactersPerMinute,
                        backspaceRate,
                        pauseFrequency,
                    },
                    activityDistribution: {
                        writingPercentage,
                        editingPercentage,
                        reviewingPercentage,
                        aiAssistedPercentage,
                    },
                },
                timelineData,
            };
        }
        catch (error) {
            logger_1.default.error("Error getting detailed activity tracking", {
                error: error.message,
                projectId,
            });
            throw new Error(`Failed to get detailed activity tracking: ${error.message}`);
        }
    }
}
exports.ActivityTrackingService = ActivityTrackingService;
