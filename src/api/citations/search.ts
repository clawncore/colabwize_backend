import express, { Request, Response } from "express";
import axios from "axios";
import logger from "../../monitoring/logger";
import { AcademicSearchService } from "../../services/academicSearchService";
import { SubscriptionService } from "../../services/subscriptionService";

const router = express.Router();

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
  };
}

/**
 * GET /api/citations/search
 * Search for papers using AcademicSearchService (Semantic Scholar -> OpenAlex)
 * Query params: q (search query)
 */
router.get("/search", async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Check limits and consume action
    const consumption = await SubscriptionService.consumeAction(
      userId,
      "paper_search"
    );

    if (!consumption.allowed) {
      return res.status(403).json({
        success: false,
        message: consumption.message || "Monthly search limit reached",
        requiresUpgrade: true,
      });
    }

    const query = req.query.q as string;

    if (!query) {
      return res.status(400).json({
        success: false,
        message: "Search query is required",
      });
    }

    console.log(`Searching Academic Papers for: ${query}`);

    // Use the Aggregator Service
    const papers = await AcademicSearchService.searchPapers(query);

    return res.status(200).json({
      success: true,
      data: papers,
      remaining: consumption.remaining,
    });
  } catch (error: any) {
    logger.error("Error searching academic papers", { error: error.message });
    return res.status(500).json({
      success: false,
      message: "Failed to search for papers",
    });
  }
});

/**
 * POST /api/citations/legitimize
 * Find evidence for a specific factual claim
 */
router.post("/legitimize", async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const { claim, context } = req.body;

    if (!claim) {
      return res.status(400).json({
        success: false,
        message: "Claim text is required",
      });
    }

    // Check limits (Reuse paper_search or new limit?)
    const consumption = await SubscriptionService.consumeAction(
      userId,
      "paper_search"
    );

    if (!consumption.allowed) {
      return res.status(403).json({
        success: false,
        message: consumption.message,
        requiresUpgrade: true,
      });
    }

    // Use the context if available to refine search?
    // For now, search the claim directly
    const papers = await AcademicSearchService.findEvidenceForClaim(claim);

    return res.status(200).json({
      success: true,
      data: papers,
      message: papers.length > 0 ? "Evidence found" : "No direct evidence found",
    });

  } catch (error: any) {
    logger.error("Error legitimizing claim", { error: error.message });
    return res.status(500).json({
      success: false,
      message: "Failed to find evidence",
    });
  }
});

// End of router
export default router;
