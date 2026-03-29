import axios from "axios";
import logger from "../monitoring/logger";
import { SecretsService } from "./secrets-service";

export interface AcademicPaper {
  id: string;
  externalId?: string; // Alias used by the federated aggregator in paperDiscoveryService
  title: string;
  authors: string[];
  year: number;
  abstract?: string;
  url: string;
  citationCount: number;
  openAccessPdf?: string;
  venue?: string; // Journal or Conference
  similarity?: number; // [NEW] For ranking/display
  source:
    | "semantic_scholar"
    | "openalex"
    | "arxiv"
    | "pubmed"
    | "ieee"
    | "doaj"
    | "crossref";
}

export class SemanticScholarService {
  private static readonly API_URL = "https://api.semanticscholar.org/graph/v1";

  // Rate Limiting: 1 request per second
  private static lastRequestTime = 0;
  private static readonly RATE_LIMIT_MS = 1000;
  private static requestQueue: Promise<void> = Promise.resolve();

  /**
   * Enforce rate limit sequentially using a promise queue.
   */
  private static async waitForRateLimit(): Promise<void> {
    this.requestQueue = this.requestQueue.then(async () => {
      const now = Date.now();
      const timeSinceLast = now - this.lastRequestTime;
      if (timeSinceLast < this.RATE_LIMIT_MS) {
        await new Promise((resolve) =>
          setTimeout(resolve, this.RATE_LIMIT_MS - timeSinceLast)
        );
      }
      this.lastRequestTime = Date.now();
    });
    return this.requestQueue;
  }

  /**
   * Search for papers by query (e.g., specific claim or topic)
   */
  static async searchPapers(
    query: string,
    limit: number = 5,
  ): Promise<AcademicPaper[]> {
    try {
      const apiKey = await SecretsService.getSemanticScholarApiKey();
      const headers: any = {};
      if (apiKey) {
        headers["x-api-key"] = apiKey;
      }

      // Fields to retrieve
      const fields =
        "paperId,title,authors,year,abstract,url,citationCount,isOpenAccess,openAccessPdf,venue";

      await this.waitForRateLimit();

      const response = await axios.get(`${this.API_URL}/paper/search`, {
        params: {
          query,
          limit,
          fields,
        },
        headers,
      });

      if (!response.data || !response.data.data) {
        return [];
      }

      return response.data.data.map((paper: any) =>
        this.mapToAcademicPaper(paper),
      );
    } catch (error: any) {
      logger.error("Semantic Scholar search failed", {
        error: error.message,
        query,
      });
      throw error;
    }
  }

  /**
   * Get paper details by DOI
   */
  static async getPaperByDoi(doi: string): Promise<AcademicPaper | null> {
    try {
      const apiKey = await SecretsService.getSemanticScholarApiKey();
      const headers: any = {};
      if (apiKey) {
        headers["x-api-key"] = apiKey;
      }

      const fields =
        "paperId,title,authors,year,abstract,url,citationCount,isOpenAccess,openAccessPdf,venue";

      await this.waitForRateLimit();

      const response = await axios.get(`${this.API_URL}/paper/DOI:${doi}`, {
        params: { fields },
        headers,
      });

      if (!response.data) return null;

      return this.mapToAcademicPaper(response.data);
    } catch (error: any) {
      if (error.response?.status === 404) return null;
      logger.error("Semantic Scholar DOI lookup failed", {
        error: error.message,
        doi,
      });
      throw error;
    }
  }

  private static mapToAcademicPaper(raw: any): AcademicPaper {
    return {
      id: raw.paperId,
      title: raw.title,
      authors: raw.authors?.map((a: any) => a.name) || [],
      year: raw.year || new Date().getFullYear(),
      abstract: raw.abstract,
      url: raw.url || `https://www.semanticscholar.org/paper/${raw.paperId}`,
      citationCount: raw.citationCount || 0,
      openAccessPdf: raw.openAccessPdf?.url,
      venue: raw.venue,
      source: "semantic_scholar",
    };
  }
}
