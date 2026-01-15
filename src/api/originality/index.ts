import express, { Request, Response } from "express";
import { OriginalityMapService } from "../../services/originalityMapService";
import { RephraseService } from "../../services/rephraseService";
import logger from "../../monitoring/logger";
import rateLimit from "express-rate-limit";
import {
  checkUsageLimit,
  incrementFeatureUsage,
} from "../../middleware/usageMiddleware";
import { SubscriptionService } from "../../services/subscriptionService";
import compareRouter from "./compare";
import enhancedRouter from "./enhanced";
import { prisma } from "../../lib/prisma";
import { EnhancedOriginalityDetectionService } from "../../services/enhancedOriginalityDetectionService";

const router = express.Router();

router.use("/", compareRouter);

// Enhanced originality detection routes
router.use("/enhanced", enhancedRouter);

// Rate limiters
const scanLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  message: "Too many scan requests, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
});

const rephraseLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 requests per minute
  message: "Too many rephrase requests, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * POST /api/originality/scan
 * Scan document for originality
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

      // Get user's plan to determine limits
      const plan = await SubscriptionService.getActivePlan(userId);
      const limits = SubscriptionService.getPlanLimits(plan);
      const limit = limits.max_scan_characters || 100000;

      if (content.length > limit) {
        return res.status(400).json({
          success: false,
          message: `Content too large for your plan (limit: ${limit.toLocaleString()} characters). Please upgrade for higher limits.`,
        });
      }

      logger.info("Starting originality scan", { userId, projectId, plan });

      // Perform scan
      const result = await OriginalityMapService.scanDocument(
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
      logger.error("Error in scan endpoint", { error: error.message });

      return res.status(500).json({
        success: false,
        message: error.message || "Failed to scan document",
      });
    }
  }
);

/**
 * GET /api/originality/scan/:scanId
 * Get scan results by ID
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

    const result = await OriginalityMapService.getScanResults(scanId, userId);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    logger.error("Error getting scan results", { error: error.message });

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
 * GET /api/originality/project/:projectId
 * Get all scans for a project
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

    const results = await OriginalityMapService.getProjectScans(
      projectId,
      userId
    );

    return res.status(200).json({
      success: true,
      data: results,
    });
  } catch (error: any) {
    logger.error("Error getting project scans", { error: error.message });

    return res.status(500).json({
      success: false,
      message: error.message || "Failed to get project scans",
    });
  }
});

/**
 * POST /api/originality/rephrase
 * Get rephrase suggestions for flagged text
 */
router.post(
  "/rephrase",
  rephraseLimiter,
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

      logger.info("Generating rephrase suggestions", {
        userId,
        scanId,
        matchId,
      });

      // Generate suggestions
      const suggestions = await RephraseService.generateRephraseSuggestions(
        scanId,
        matchId,
        originalText,
        userId
      );

      return res.status(200).json({
        success: true,
        data: suggestions,
      });
    } catch (error: any) {
      logger.error("Error generating rephrase suggestions", {
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

/**
 * GET /api/originality/scan/:scanId/suggestions
 * Get all rephrase suggestions for a scan
 */
router.get("/scan/:scanId/suggestions", async (req: Request, res: Response) => {
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

    const suggestions = await RephraseService.getScanSuggestions(
      scanId,
      userId
    );

    return res.status(200).json({
      success: true,
      data: suggestions,
    });
  } catch (error: any) {
    logger.error("Error getting scan suggestions", { error: error.message });

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
      message: error.message || "Failed to get scan suggestions",
    });
  }
});

/**
 * POST /api/originality/check-self-plagiarism
 * Check for self-plagiarism against user's recent projects
 */
router.post("/check-self-plagiarism", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const { currentContent, currentProjectId } = req.body;

    if (!currentContent || !currentProjectId) {
      return res.status(400).json({
        success: false,
        message: "currentContent and currentProjectId are required",
      });
    }

    // Get user's recent projects (excluding current project)
    const recentProjects = await prisma.project.findMany({
      where: {
        user_id: userId,
        id: { not: currentProjectId }, // Exclude current project
        created_at: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
        },
      },
      select: {
        id: true,
        title: true,
        content: true,
        created_at: true,
      },
      orderBy: {
        created_at: "desc",
      },
      take: 10, // Get last 10 projects
    });

    // Compare current content against each recent project
    const results = [];
    for (const project of recentProjects) {
      if (project.content) {
        // Only compare if content exists
        const projectContent =
          typeof project.content === "string"
            ? project.content
            : JSON.stringify(project.content);

        const comparison = EnhancedOriginalityDetectionService.compareDrafts(
          currentContent,
          projectContent
        );

        // Only include results with significant similarity
        if (comparison.similarityScore > 20) {
          // Threshold for self-plagiarism
          results.push({
            ...comparison,
            comparedWith: project.title,
            projectId: project.id,
            createdAt: project.created_at,
          });
        }
      }
    }

    return res.status(200).json({
      success: true,
      data: results,
    });
  } catch (error: any) {
    logger.error("Error checking self-plagiarism", { error: error.message });

    return res.status(500).json({
      success: false,
      message: error.message || "Failed to check self-plagiarism",
    });
  }
});

export default router;
