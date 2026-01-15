import express, { Request, Response } from "express";
import axios from "axios";
import logger from "../../monitoring/logger";

const router = express.Router();

/**
 * GET /api/citations/search
 * Search for papers using OpenAlex API
 * Query params: q (search query)
 */
router.get("/search", async (req: Request, res: Response) => {
  try {
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
