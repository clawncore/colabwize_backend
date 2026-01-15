import express, { Request, Response } from "express";
import { AnalyticsService } from "../../services/analyticsService";
import logger from "../../monitoring/logger";
import { prisma } from "../../lib/prisma";

const router = express.Router();

/**
 * POST /api/analytics/track
 * Track an analytics event
 */
router.post("/track", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;

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

    await AnalyticsService.trackEvent({
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
  } catch (error: any) {
    logger.error("Error tracking event", { error: error.message });

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
router.get("/summary", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const summary = await AnalyticsService.getAnalyticsSummary(userId);

    return res.status(200).json({
      success: true,
      data: summary,
    });
  } catch (error: any) {
    logger.error("Error getting analytics summary", { error: error.message });

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
router.get("/metrics", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const metrics = await AnalyticsService.getUserMetrics(userId);

    return res.status(200).json({
      success: true,
      data: metrics,
    });
  } catch (error: any) {
    logger.error("Error getting user metrics", { error: error.message });

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
router.get("/dashboard", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Get the most recent scan results from the specific services

    // Get the most recent originality scan
    const latestOriginalityScan = await prisma.originalityScan.findFirst({
      where: { user_id: userId },
      orderBy: { scanned_at: "desc" },
      select: { overall_score: true, classification: true },
    });

    // Get the most recent certificate
    const latestCertificate = await prisma.certificate.findFirst({
      where: { user_id: userId },
      orderBy: { created_at: "desc" },
      select: { status: true },
    });

    // Get citation statistics
    const citationCount = await prisma.citation.count({
      where: { user_id: userId },
    });

    // Extract the actual values from the database records
    const originalityScore = latestOriginalityScan?.overall_score || undefined;

    // Convert originality classification to citation status
    let citationStatus: string | undefined = undefined;
    if (latestOriginalityScan?.classification) {
      // Map originality classification to citation status
      switch (latestOriginalityScan.classification) {
        case "safe":
          citationStatus = "strong";
          break;
        case "review":
          citationStatus = "good";
          break;
        case "action_required":
          citationStatus = "weak";
          break;
        default:
          citationStatus = "poor";
      }
    }

    const authorshipVerified = latestCertificate?.status === "completed";

    return res.status(200).json({
      success: true,
      data: {
        originality_score: originalityScore,
        citation_status: citationStatus,
        citation_count: citationCount,
        authorship_verified: authorshipVerified,
      },
    });
  } catch (error: any) {
    logger.error("Error getting dashboard analytics", { error: error.message });

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
router.get("/trends", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const months = req.query.months ? parseInt(req.query.months as string) : 6;
    const trends = await AnalyticsService.getUsageTrends(userId, months);

    return res.status(200).json({
      success: true,
      data: trends,
    });
  } catch (error: any) {
    logger.error("Error getting usage trends", { error: error.message });

    return res.status(500).json({
      success: false,
      message: "Failed to get usage trends",
    });
  }
});

export default router;
