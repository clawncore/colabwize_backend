import express, { Request, Response } from "express";
import { EnhancedOriginalityDetectionService } from "../../services/enhancedOriginalityDetectionService";
import { RephraseService } from "../../services/rephraseService";
import logger from "../../monitoring/logger";
import rateLimit from "express-rate-limit";
import {
  checkUsageLimit,
  incrementFeatureUsage,
} from "../../middleware/usageMiddleware";
import { SubscriptionService } from "../../services/subscriptionService";

const router = express.Router();

// Rate limiters
const scanLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 requests per minute (more restrictive for enhanced service)
  message: "Too many enhanced scan requests, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
});

const rephraseLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  message: "Too many rephrase requests, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * POST /api/originality/enhanced/scan
 * Enhanced scan document for originality with academic database integration
 */
router.post(
  "/scan",
  scanLimiter,
  checkUsageLimit("originality_scan"),
  async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      const { projectId, content } = req.body;

      // Validation
      if (!projectId || !content) {
        return res.status(400).json({
          success: false,
          message: "projectId and content are required",
        });
      }

      if (typeof content !== "string" || content.trim().length === 0) {
        return res.status(400).json({
          success: false,
          message: "Content must be a non-empty string",
        });
      }

      if (content.length > 100000) {
        return res.status(400).json({
          success: false,
          message: "Content too large (max 100,000 characters)",
        });
      }

      logger.info("Starting enhanced originality scan", { userId, projectId });

      // Get user's plan to determine scan depth (Basic vs Full)
      const plan = await SubscriptionService.getActivePlan(userId);

      // Perform enhanced scan with academic database integration
      const result = await EnhancedOriginalityDetectionService.scanDocument(
        projectId,
        userId,
        content,
        plan
      );

      // Increment usage counter after successful scan
      await incrementFeatureUsage("originality_scan")(req, res, () => {});

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      logger.error("Error in enhanced scan endpoint", { error: error.message });

      return res.status(500).json({
        success: false,
        message: error.message || "Failed to scan document",
      });
    }
  }
);

/**
 * GET /api/originality/enhanced/scan/:scanId
 * Get enhanced scan results by ID
 */
router.get("/scan/:scanId", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const { scanId } = req.params;

    if (!scanId) {
      return res.status(400).json({
        success: false,
        message: "scanId is required",
      });
    }

    const result = await EnhancedOriginalityDetectionService.getScanResults(
      scanId,
      userId
    );

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    logger.error("Error getting enhanced scan results", {
      error: error.message,
    });

    if (
      error.message.includes("not found") ||
      error.message.includes("access denied")
    ) {
      return res.status(404).json({
        success: false,
        message: "Scan not found",
      });
    }

    return res.status(500).json({
      success: false,
      message: error.message || "Failed to get scan results",
    });
  }
});

/**
 * GET /api/originality/enhanced/project/:projectId
 * Get all enhanced scans for a project
 */
router.get("/project/:projectId", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const { projectId } = req.params;

    if (!projectId) {
      return res.status(400).json({
        success: false,
        message: "projectId is required",
      });
    }

    const results = await EnhancedOriginalityDetectionService.getProjectScans(
      projectId,
      userId
    );

    return res.status(200).json({
      success: true,
      data: results,
    });
  } catch (error: any) {
    logger.error("Error getting enhanced project scans", {
      error: error.message,
    });

    return res.status(500).json({
      success: false,
      message: error.message || "Failed to get project scans",
    });
  }
});

/**
 * POST /api/originality/enhanced/rephrase
 * Get rephrase suggestions for flagged text using enhanced analysis
 */
router.post(
  "/rephrase",
  rephraseLimiter,
  checkUsageLimit("rephrase_suggestions"),
  async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      const { scanId, matchId, originalText } = req.body;

      // Validation
      if (!scanId || !matchId || !originalText) {
        return res.status(400).json({
          success: false,
          message: "scanId, matchId, and originalText are required",
        });
      }

      if (
        typeof originalText !== "string" ||
        originalText.trim().length === 0
      ) {
        return res.status(400).json({
          success: false,
          message: "originalText must be a non-empty string",
        });
      }

      logger.info("Generating enhanced rephrase suggestions", {
        userId,
        scanId,
        matchId,
      });

      // Generate suggestions using enhanced analysis
      const suggestions = await RephraseService.generateRephraseSuggestions(
        scanId,
        matchId,
        originalText,
        userId
      );

      // Increment usage counter
      await incrementFeatureUsage("rephrase_suggestions")(req, res, () => {});

      return res.status(200).json({
        success: true,
        data: suggestions,
      });
    } catch (error: any) {
      logger.error("Error generating enhanced rephrase suggestions", {
        error: error.message,
      });

      if (
        error.message.includes("not found") ||
        error.message.includes("access denied")
      ) {
        return res.status(404).json({
          success: false,
          message: "Scan not found",
        });
      }

      return res.status(500).json({
        success: false,
        message: error.message || "Failed to generate rephrase suggestions",
      });
    }
  }
);

export default router;
