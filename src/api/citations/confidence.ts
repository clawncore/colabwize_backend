import express, { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { CitationConfidenceService } from "../../services/citationConfidenceService";
import logger from "../../monitoring/logger";
import { checkUsageLimit, incrementFeatureUsage } from "../../middleware/usageMiddleware";

const router = express.Router();

/**
 * GET /api/citations/confidence/:projectId
 * Get citation confidence analysis for a project
 */
router.get(
  "/confidence/:projectId",
  checkUsageLimit("citation_check"),  // Changed from "scan" to "citation_check"
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
    const { field } = req.query; // Optional field parameter

    if (!projectId) {
      return res.status(400).json({
        success: false,
        error: "Project ID is required",
      });
    }

    const analysis = await CitationConfidenceService.analyzeProjectCitations(
      projectId,
      userId,
      (field as string) || "default"
    );

    logger.info("Citation confidence analysis retrieved", {
      userId,
      projectId,
      totalCitations: analysis.totalCitations,
      overallScore: analysis.overallConfidence.overall,
    });

    return res.status(200).json({
      success: true,
      data: analysis,
    });

    // Increment usage counter after successful analysis
    await incrementFeatureUsage("scan")(req, res, () => {});

    return res.status(200).json({
      success: true,
      data: analysis,
    });
  } catch (error: any) {
    logger.error("Error getting citation confidence", {
      error: error.message,
      stack: error.stack,
    });

    return res.status(500).json({
      success: false,
      error: error.message || "Failed to analyze citation confidence",
    });
  }
});

/**
 * GET /api/citations/recency/:projectId
 * Get recency breakdown for project citations
 */
router.get(
  "/recency/:projectId",
  checkUsageLimit("citation_check"),
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
    const { field } = req.query;

    if (!projectId) {
      return res.status(400).json({
        success: false,
        error: "Project ID is required",
      });
    }

    const analysis = await CitationConfidenceService.analyzeProjectCitations(
      projectId,
      userId,
      (field as string) || "default"
    );

    return res.status(200).json({
      success: true,
      data: {
        breakdown: analysis.citationBreakdown,
        totalCitations: analysis.totalCitations,
        hasRecentCitations: analysis.citationBreakdown.recent > 0,
        warning:
          analysis.citationBreakdown.recent === 0
            ? "No citations from the last 3 years"
            : null,
      },
    });
  } catch (error: any) {
    logger.error("Error getting citation recency", {
      error: error.message,
      stack: error.stack,
    });

    return res.status(500).json({
      success: false,
      error: error.message || "Failed to analyze citation recency",
    });
  }
});

export default router;
