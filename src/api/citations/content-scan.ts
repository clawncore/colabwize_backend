import express, { Request, Response } from "express";
import { CitationConfidenceService } from "../../services/citationConfidenceService";
import logger from "../../monitoring/logger";
import {
  checkUsageLimit,
  incrementFeatureUsage,
} from "../../middleware/usageMiddleware";
import { prisma } from "../../lib/prisma";

const router = express.Router();

/**
 * POST /api/citations/content-scan
 * Scan text content for missing citations
 */
router.post(
  "/content-scan",
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

      const { content, projectId } = req.body;

      if (!content && !projectId) {
        return res.status(400).json({
          success: false,
          error: "Content or Project ID is required",
        });
      }

      let textToScan = content;

      // If projectId is provided but no content, fetch from project
      if (!textToScan && projectId) {
        const project = await prisma.project.findUnique({
          where: { id: projectId },
        });

        if (!project || project.user_id !== userId) {
          return res.status(404).json({
            success: false,
            error: "Project not found or access denied",
          });
        }

        // Assuming content is stored in project.content (JSON) or we extract it
        // For now, let's assume we can't easily extract from JSON in this simple pass
        // unless we have a helper.
        // But wait, the user might be editing live.
        // It's safer if the Frontend sends the content.
        // If we strictly need to support projectId-only scan, we'd need a JSON->Text converter here.
        // For MVP, if content is missing, we'll error if we can't get it easily.
        // Let's assume the frontend sends the content for now.
        return res.status(400).json({
          success: false,
          error: "Please provide content to scan",
        });
      }

      const suggestions =
        CitationConfidenceService.scanContentForCitations(textToScan);

      // Increment usage
      await incrementFeatureUsage("citation_check")(req, res, () => {});

      return res.status(200).json({
        success: true,
        data: {
          suggestions,
          matchCount: suggestions.length,
        },
      });
    } catch (error: any) {
      logger.error("Error scanning content for citations", {
        error: error.message,
        stack: error.stack,
      });

      return res.status(500).json({
        success: false,
        error: error.message || "Failed to scan content",
      });
    }
  }
);

export default router;
