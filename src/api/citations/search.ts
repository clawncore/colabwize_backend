import express, { Request, Response } from "express";
import axios from "axios";
import logger from "../../monitoring/logger";
import { AcademicSearchService } from "../../services/academicSearchService";
import { BillingGateway, BillingError } from "../../billing/BillingGateway";

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
  await handleSearch(req, res);
});

/**
 * GET /api/citations/search-external
 * Alias for /search used by some frontend components
 */
router.get("/search-external", async (req: Request, res: Response) => {
  await handleSearch(req, res);
});

async function handleSearch(req: Request, res: Response) {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const query = req.query.q as string;
    // `enrich=1` marks an auto-enrichment call (background metadata fetch
    // when citations are detected on editor load). These are FREE — only
    // intentional user searches (the Search button) count against quota.
    const isEnrichment = req.query.enrich === "1";

    if (!query) {
      return res.status(400).json({
        success: false,
        message: "Search query is required",
      });
    }

    console.log(`Searching Academic Papers for: ${query} (enrich: ${isEnrichment})`);

    // Auto-enrichment bypasses the billing gate entirely — it's a background
    // metadata fetch, not a user-initiated search. Only manual searches run
    // through the hold → execute → confirm/release pipeline.
    if (isEnrichment) {
      try {
        const papers = await AcademicSearchService.searchPapers(query);
        return res.status(200).json({ success: true, data: papers });
      } catch (error: any) {
        logger.error("Error auto-enriching papers", { error: error.message });
        return res.status(500).json({ success: false, message: "Failed to search papers" });
      }
    }

    // Manual search: run through the single billing pipeline.
    try {
      const papers = await BillingGateway.withFeature(
        userId,
        "paper_search",
        undefined,
        () => AcademicSearchService.searchPapers(query),
      );

      return res.status(200).json({
        success: true,
        data: papers,
      });
    } catch (e: any) {
      if (e instanceof BillingError) {
        const status = e.code === "INSUFFICIENT_CREDITS" ? 402 : 403;
        return res.status(status).json({
          success: false,
          message: e.message || "Monthly search limit reached",
          code: e.code,
          requiresUpgrade: true,
          ...e.data,
        });
      }
      throw e;
    }
  } catch (error: any) {
    logger.error("Error searching academic papers", { error: error.message });
    return res.status(500).json({
      success: false,
      message: "Failed to search for papers",
    });
  }
}

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
    void context;

    if (!claim) {
      return res.status(400).json({
        success: false,
        message: "Claim text is required",
      });
    }

    // Run through the single billing pipeline (hold → execute →
    // confirm/release), consuming paper_search quota.
    // Use the claim directly as the evidence search query.
    const papers = await BillingGateway.withFeature(
      userId,
      "paper_search",
      undefined,
      () => AcademicSearchService.findEvidenceForClaim(claim),
    );

    return res.status(200).json({
      success: true,
      data: papers,
      message:
        papers.length > 0 ? "Evidence found" : "No direct evidence found",
    });
  } catch (e: any) {
    if (e instanceof BillingError) {
      const status = e.code === "INSUFFICIENT_CREDITS" ? 402 : 403;
      return res.status(status).json({
        success: false,
        message: e.message || "Monthly search limit reached",
        code: e.code,
        requiresUpgrade: true,
        ...e.data,
      });
    }
    logger.error("Error legitimizing claim", { error: e.message });
    return res.status(500).json({
      success: false,
      message: "Failed to find evidence",
    });
  }
});

export default router;
