import express, { Request, Response } from "express";
import { CitationConfidenceService } from "../../services/citationConfidenceService";
import logger from "../../monitoring/logger";
import { checkUsageLimit } from "../../middleware/usageMiddleware";

const router = express.Router();

/**
 * POST /api/citations/:projectId
 * Add a citation to a project
 */
router.post(
  "/:projectId",
  // checkUsageLimit("citation_check"), // Optional: limit adding citations? Probably not needed.
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
      const { title, author, year, type, doi, url, source } = req.body;

      if (!projectId) {
        return res.status(400).json({
          success: false,
          error: "Project ID is required",
        });
      }

      if (!title || !author || !year) {
        return res.status(400).json({
          success: false,
          error: "Title, author, and year are required",
        });
      }

      const citation = await CitationConfidenceService.addCitation(
        projectId,
        userId,
        {
          title,
          author,
          year,
          type: type || "journal-article",
          doi,
          url,
          source,
        }
      );

      return res.status(201).json({
        success: true,
        data: citation,
      });
    } catch (error: any) {
      logger.error("Error adding citation", {
        error: error.message,
        stack: error.stack,
      });

      return res.status(500).json({
        success: false,
        error: error.message || "Failed to add citation",
      });
    }
  }
);

export default router;
