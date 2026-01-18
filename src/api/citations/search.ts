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

/**
 * GET /api/citations/search
 * Search for papers using OpenAlex API
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

    // Call OpenAlex API
    // https://api.openalex.org/works?search=query
    const openAlexUrl = `https://api.openalex.org/works`;

    console.log(`Searching OpenAlex for: ${query}`);

    const response = await axios.get(openAlexUrl, {
      params: {
        search: query,
        per_page: 8, // Reduced from 10 for faster response
        // Select only fields we need to reduce payload
        select:
          "id,title,publication_year,primary_location,authorships,cited_by_count",
      },
      timeout: 5000, // Reduced to 5s for faster response
    });

    const works = response.data.results || [];

    // Map OpenAlex results to our schema
    const suggestions = works.map((work: any) => {
      // Extract authors
      const authors =
        work.authorships?.map((a: any) => a.author.display_name) || [];

      // Extract venue/source
      const source =
        work.primary_location?.source?.display_name || "Unknown Source";

      // Extract abstract (OpenAlex uses inverted index, so we might skip this or reconstruct it if absolutely needed.
      // For MVP, we'll skip complex abstract reconstruction as it's heavy)
      // Or use snippet if available. OpenAlex doesn't always provide simple abstracts.

      return {
        title: work.title,
        authors: authors.slice(0, 3), // Top 3 authors
        year: work.publication_year,
        source: source,
        abstract: "", // OpenAlex doesn't provide plain abstracts easily
        relevanceScore: 100, // Default for manual search
        url: work.id, // OpenAlex ID
        citationCount: work.cited_by_count,
        doi: work.doi,
      };
    });

    return res.status(200).json({
      success: true,
      data: suggestions,
      remaining: consumption.remaining, // Optional: return remaining count
    });
  } catch (error: any) {
    logger.error("Error searching OpenAlex", { error: error.message });
    console.error("OpenAlex Search Error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to search for papers",
    });
  }
});

export default router;
