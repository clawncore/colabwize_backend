import express, { Request, Response } from "express";
import { ActivityTrackingService } from "../../services/activityTrackingService";
import { authenticateExpressRequest } from "../../middleware/auth";
import logger from "../../monitoring/logger";

const router = express.Router();

/**
 * POST /api/authorship/record-activity
 * Record authorship activity (time spent, edits, keystrokes)
 */
router.post(
  "/record-activity",
  authenticateExpressRequest,
  async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "Authentication required",
        });
      }

      const { projectId, timeSpent, editCount, keystrokes, wordCount } =
        req.body;

      if (!projectId || timeSpent === undefined || editCount === undefined) {
        return res.status(400).json({
          success: false,
          error: "projectId, timeSpent, and editCount are required",
        });
      }

      await ActivityTrackingService.recordActivity({
        projectId,
        userId,
        timeSpent,
        editCount,
        keystrokes,
        wordCount,
        sessionStart: new Date(Date.now() - timeSpent * 1000),
        sessionEnd: new Date(),
      });

      logger.info("Activity recorded successfully", {
        userId,
        projectId,
        timeSpent,
        editCount,
      });

      return res.status(200).json({
        success: true,
        message: "Activity recorded successfully",
      });
    } catch (error: any) {
      logger.error("Error recording activity", {
        error: error.message,
        stack: error.stack,
      });

      return res.status(500).json({
        success: false,
        error: error.message || "Failed to record activity",
      });
    }
  }
);

/**
 * GET /api/authorship/stats/:projectId
 * Get authorship statistics for a project
 */
router.get(
  "/stats/:projectId",
  authenticateExpressRequest,
  async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "Authentication required",
        });
      }

      const { projectId } = req.params;

      if (!projectId) {
        return res.status(400).json({
          success: false,
          error: "Project ID is required",
        });
      }

      const stats = await ActivityTrackingService.getActivityStats(
        projectId,
        userId
      );

      return res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (error: any) {
      logger.error("Error getting authorship stats", {
        error: error.message,
        stack: error.stack,
      });

      return res.status(500).json({
        success: false,
        error: error.message || "Failed to get authorship statistics",
      });
    }
  }
);

/**
 * GET /api/authorship/quick-stats/:projectId
 * Get quick authorship stats for dashboard display
 */
router.get(
  "/quick-stats/:projectId",
  authenticateExpressRequest,
  async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "Authentication required",
        });
      }

      const { projectId } = req.params;

      if (!projectId) {
        return res.status(400).json({
          success: false,
          error: "Project ID is required",
        });
      }

      const summary = await ActivityTrackingService.getActivitySummary(
        projectId,
        userId
      );

      // Extract quick stats
      const quickStats = {
        totalTimeSpent: ActivityTrackingService.formatTimeForCertificate(
          summary.totalTimeSpent
        ),
        totalEdits: summary.totalEdits,
        totalSessions: summary.totalSessions,
        lastActivity: summary.lastActivity,
      };

      return res.status(200).json({
        success: true,
        data: quickStats,
      });
    } catch (error: any) {
      logger.error("Error getting quick stats", {
        error: error.message,
        stack: error.stack,
      });

      return res.status(500).json({
        success: false,
        error: error.message || "Failed to get quick statistics",
      });
    }
  }
);

/**
 * POST /api/authorship/generate-certificate
 * Generate authorship certificate for a project
 */
router.post(
  "/generate-certificate",
  authenticateExpressRequest,
  async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "Authentication required",
        });
      }

      const { projectId } = req.body;

      if (!projectId) {
        return res.status(400).json({
          success: false,
          error: "Project ID is required",
        });
      }

      const certificateStats =
        await ActivityTrackingService.getCertificateStats(projectId, userId);

      logger.info("Certificate generated", {
        userId,
        projectId,
      });

      return res.status(200).json({
        success: true,
        data: certificateStats,
      });
    } catch (error: any) {
      logger.error("Error generating certificate", {
        error: error.message,
        stack: error.stack,
      });

      return res.status(500).json({
        success: false,
        error: error.message || "Failed to generate certificate",
      });
    }
  }
);

/**
 * GET /api/authorship/detailed-tracking/:projectId
 * Get detailed granular activity tracking for a project
 */
router.get(
  "/detailed-tracking/:projectId",
  authenticateExpressRequest,
  async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "Authentication required",
        });
      }

      const { projectId } = req.params;
      const { timeFrameDays = "30" } = req.query;

      if (!projectId) {
        return res.status(400).json({
          success: false,
          error: "Project ID is required",
        });
      }

      const days = parseInt(timeFrameDays as string) || 30;

      const detailedTracking =
        await ActivityTrackingService.getDetailedActivityTracking(
          projectId,
          userId,
          days
        );

      return res.status(200).json({
        success: true,
        data: detailedTracking,
      });
    } catch (error: any) {
      logger.error("Error getting detailed activity tracking", {
        error: error.message,
        stack: error.stack,
      });

      return res.status(500).json({
        success: false,
        error: error.message || "Failed to get detailed activity tracking",
      });
    }
  }
);

export default router;
