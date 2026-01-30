import express, { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { CitationConfidenceService } from "../../services/citationConfidenceService";
import logger from "../../monitoring/logger";

import { getSafeString } from "../../utils/requestHelpers";

const router = express.Router();

/**
 * GET /api/citations/confidence/:projectId
 * Get citation confidence analysis for a project
 */
router.get(
  "/confidence/:projectId",

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
        projectId as string,
        userId,
        getSafeString(field) || "default"
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
        projectId as string,
        userId,
        getSafeString(field) || "default"
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

/**
 * POST /api/citations/verify-single
 * Real-time verification of a single citation
 */
router.post(
  "/verify-single",
  // Rate limit? Maybe lighter limit
  async (req: Request, res: Response) => {
    try {
      const { title, doi } = req.body;
      if (!title) {
        return res.status(400).json({ success: false, error: "Title is required" });
      }

      const result = await CitationConfidenceService.verifySingleCitation({ title, doi });
      return res.status(200).json({ success: true, data: result });
    } catch (error: any) {
      logger.error("Error confirming citation", { error: error.message });
      return res.status(500).json({ success: false, error: "Verification failed" });
    }
  }
);

/**
 * POST /api/citations/auto-fix
 * Find correct metadata for fuzzy citation
 */
router.post(
  "/auto-fix",
  async (req: Request, res: Response) => {
    try {
      const { query } = req.body;
      if (!query) return res.status(400).json({ success: false, error: "Query is required" });

      const result = await CitationConfidenceService.findCitationMetadata(query);
      return res.status(200).json({ success: true, data: result });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: "Auto-fix failed" });
    }
  }
);

export default router;
