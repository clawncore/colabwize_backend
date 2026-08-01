"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const analyticsService_1 = require("../../services/analyticsService");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const prisma_1 = require("../../lib/prisma");
const router = express_1.default.Router();
/**
 * POST /api/analytics/track
 * Track an analytics event
 */
router.post("/track", async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Authentication required",
            });
        }
        const { eventType, eventName, eventData, projectId, sessionId } = req.body;
        // Validation
        if (!eventType || !eventName) {
            return res.status(400).json({
                success: false,
                message: "eventType and eventName are required",
            });
        }
        await analyticsService_1.AnalyticsService.trackEvent({
            userId,
            projectId,
            eventType,
            eventName,
            eventData,
            sessionId,
        });
        return res.status(200).json({
            success: true,
            message: "Event tracked successfully",
        });
    }
    catch (error) {
        logger_1.default.error("Error tracking event", { error: error.message });
        return res.status(500).json({
            success: false,
            message: "Failed to track event",
        });
    }
});
/**
 * GET /api/analytics/summary
 * Get analytics summary for current user
 */
router.get("/summary", async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Authentication required",
            });
        }
        const summary = await analyticsService_1.AnalyticsService.getAnalyticsSummary(userId);
        return res.status(200).json({
            success: true,
            data: summary,
        });
    }
    catch (error) {
        logger_1.default.error("Error getting analytics summary", { error: error.message });
        return res.status(500).json({
            success: false,
            message: "Failed to get analytics summary",
        });
    }
});
/**
 * GET /api/analytics/metrics
 * Get user metrics
 */
router.get("/metrics", async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Authentication required",
            });
        }
        const metrics = await analyticsService_1.AnalyticsService.getUserMetrics(userId);
        return res.status(200).json({
            success: true,
            data: metrics,
        });
    }
    catch (error) {
        logger_1.default.error("Error getting user metrics", { error: error.message });
        return res.status(500).json({
            success: false,
            message: "Failed to get user metrics",
        });
    }
});
/**
 * GET /api/analytics/dashboard
 * Get dashboard-specific analytics for current user
 */
router.get("/dashboard", async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Authentication required",
            });
        }
        // Get the most recent scan results from the specific services
        // Get the most recent originality scan (personal projects only)
        const latestOriginalityScan = await prisma_1.prisma.originalityScan.findFirst({
            where: {
                user_id: userId,
                project: {
                    workspace_id: null
                }
            },
            orderBy: { scanned_at: "desc" },
            select: { overall_score: true, classification: true },
        });
        // Get the most recent certificate (personal projects only)
        const latestCertificate = await prisma_1.prisma.certificate.findFirst({
            where: {
                user_id: userId,
                project: {
                    workspace_id: null
                }
            },
            orderBy: { created_at: "desc" },
            select: { status: true },
        });
        // Get citation statistics (personal projects only)
        const citationCount = await prisma_1.prisma.citation.count({
            where: {
                user_id: userId,
                project: {
                    workspace_id: null
                }
            },
        });
        // Get upcoming deadlines
        const upcomingDeadlines = await prisma_1.prisma.project.findMany({
            where: {
                user_id: userId,
                due_date: { not: null },
                workspace_id: null,
                status: {
                    notIn: ["completed", "archived"]
                }
            },
            orderBy: { due_date: "asc" },
            take: 5,
            select: {
                id: true,
                title: true,
                due_date: true,
                word_count: true
            }
        });
        // Get range from query params (default to 8 weeks)
        const weeks = req.query.weeks ? parseInt(req.query.weeks) : 8;
        // Get document creation trends (last N weeks for bar chart)
        const trendData = await analyticsService_1.AnalyticsService.getWeeklyUsageTrends(userId, weeks);
        const formattedTrendData = trendData.map((t) => ({
            name: t.label, // Show the date label (e.g., "Oct 12")
            documents: t.documents
        }));
        // Extract the actual values from the database records
        const originalityScore = latestOriginalityScan?.overall_score || undefined;
        // Calculate citation status based on actual record count
        let citationStatus = "None";
        if (citationCount > 0) {
            if (citationCount > 15)
                citationStatus = "Strong";
            else if (citationCount > 8)
                citationStatus = "Good";
            else if (citationCount > 3)
                citationStatus = "Fair";
            else
                citationStatus = "Active";
        }
        const authorshipVerified = latestCertificate?.status === "completed";
        return res.status(200).json({
            success: true,
            data: {
                originality_score: originalityScore,
                citation_status: citationStatus,
                citation_count: citationCount,
                authorship_verified: authorshipVerified,
                trend_data: formattedTrendData,
                upcoming_deadlines: upcomingDeadlines
            },
        });
    }
    catch (error) {
        logger_1.default.error("Error getting dashboard analytics", { error: error.message });
        return res.status(500).json({
            success: false,
            message: "Failed to get dashboard analytics",
        });
    }
});
/**
 * GET /api/analytics/trends
 * Get usage trends (documents uploaded per month)
 */
router.get("/trends", async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Authentication required",
            });
        }
        const months = req.query.months ? parseInt(req.query.months) : 6;
        const trends = await analyticsService_1.AnalyticsService.getUsageTrends(userId, months);
        return res.status(200).json({
            success: true,
            data: trends,
        });
    }
    catch (error) {
        logger_1.default.error("Error getting usage trends", { error: error.message });
        return res.status(500).json({
            success: false,
            message: "Failed to get usage trends",
        });
    }
});
/**
 * GET /api/analytics/detailed
 * Get comprehensive analytics for the Trends tab
 */
router.get("/detailed", async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Authentication required",
            });
        }
        const [monthlyGrowth, yearlyOverview, productivityInsight, billingTrends] = await Promise.all([
            analyticsService_1.AnalyticsService.getUsageTrends(userId, 12),
            analyticsService_1.AnalyticsService.getYearlyTrends(userId),
            analyticsService_1.AnalyticsService.getProductivityInsight(userId),
            analyticsService_1.AnalyticsService.getBillingTrends(userId)
        ]);
        return res.status(200).json({
            success: true,
            data: {
                monthlyGrowth,
                yearlyOverview,
                productivityInsight,
                billingTrends
            },
        });
    }
    catch (error) {
        logger_1.default.error("Error getting detailed analytics", { error: error.message });
        return res.status(500).json({
            success: false,
            message: "Failed to get detailed analytics",
        });
    }
});
/**
 * GET /api/audit-stats
 * Get citation audit statistics for the analytics dashboard
 */
router.get("/audit-stats", async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Authentication required",
            });
        }
        const stats = await analyticsService_1.AnalyticsService.getAuditStats(userId);
        return res.status(200).json({
            success: true,
            data: stats,
        });
    }
    catch (error) {
        logger_1.default.error("Error getting audit stats", { error: error.message });
        return res.status(500).json({
            success: false,
            message: "Failed to get audit stats",
        });
    }
});
exports.default = router;
