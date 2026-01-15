import express, { Request, Response } from "express";
import { MissingLinkService } from "../../services/missingLinkService";
import logger from "../../monitoring/logger";
import rateLimit from "express-rate-limit";
import { prisma } from "../../lib/prisma";
import { checkUsageLimit } from "../../middleware/usageMiddleware";
import { sendJsonResponse, sendErrorResponse } from "../../lib/api-response";

const router = express.Router();

// Rate limiter
const missingLinkLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 requests per minute
  message: "Too many requests, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * POST /api/citations/find-missing-link
 * Suggest relevant academic papers
 */
router.post(
  "/find-missing-link",
  missingLinkLimiter,
  checkUsageLimit("citation_check"),
  async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;

      if (!userId) {
        return sendErrorResponse(res, 401, "Authentication required");
      }

      const { projectId, keywords, field, citationStyle } = req.body;

      // Validation
      if (!projectId) {
        return sendErrorResponse(res, 400, "projectId is required");
      }

      if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
        return sendErrorResponse(
          res,
          400,
          "keywords must be a non-empty array"
        );
      }

      logger.info("Finding missing link suggestions", {
        userId,
        projectId,
        keywords,
        field,
      });

      // Get suggestions
      const suggestions = await MissingLinkService.suggestPapers(
        keywords,
        field || "default",
        3 // Always return 3 suggestions
      );

      return sendJsonResponse(res, 200, {
        suggestions,
        cached: false, // Caching not required for real-time paper searches
      });
    } catch (error: any) {
      logger.error("Error finding missing link", { error: error.message });

      return sendErrorResponse(
        res,
        500,
        error.message || "Failed to find missing link suggestions"
      );
    }
  }
);

/**
 * GET /api/citations/summary
 * Get citation summary data for analytics
 */
router.get("/summary", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      return sendErrorResponse(res, 401, "Authentication required");
    }

    // Get citation statistics for the user
    const fixedCitations = await prisma.citation.count({
      where: {
        user_id: userId,
        is_reliable: true,
      },
    });

    const totalCitations = await prisma.citation.count({
      where: {
        user_id: userId,
      },
    });

    // Get previous fix rate for comparison (from last week)
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const previousFixedCitations = await prisma.citation.count({
      where: {
        user_id: userId,
        is_reliable: true,
        created_at: {
          gte: oneWeekAgo,
        },
      },
    });

    const previousTotalCitations = await prisma.citation.count({
      where: {
        user_id: userId,
        created_at: {
          gte: oneWeekAgo,
        },
      },
    });

    const fixRate =
      totalCitations > 0
        ? Math.round((fixedCitations / totalCitations) * 100)
        : 0;
    const previousFixRate =
      previousTotalCitations > 0
        ? Math.round((previousFixedCitations / previousTotalCitations) * 100)
        : 0;

    return sendJsonResponse(res, 200, {
      fixed_citations_count: fixedCitations,
      total_citations_count: totalCitations,
      fix_rate: fixRate,
      previous_fix_rate: previousFixRate,
    });
  } catch (error: any) {
    logger.error("Error getting citation summary", { error: error.message });

    return sendErrorResponse(
      res,
      500,
      error.message || "Failed to get citation summary"
    );
  }
});

export default router;
