import axios from "axios";
import logger from "../monitoring/logger";

export interface Paper {
  title: string;
  authors: string[];
  year: number;
  doi?: string;
  abstract?: string;
  citationCount?: number;
  journal?: string;
  url?: string;
}

export interface SuggestedPaper extends Paper {
  relevanceScore: number;
  citation: string;
  source: "crossref" | "pubmed" | "arxiv";
}

export class MissingLinkService {
  // API endpoints
  private static readonly CROSSREF_API = "https://api.crossref.org/works";
  private static readonly PUBMED_API =
    "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
  private static readonly ARXIV_API = "http://export.arxiv.org/api/query";

  /**
   * Main function to suggest papers based on keywords and field
   */
  static async suggestPapers(
    keywords: string[],
    field: string = "default",
    limit: number = 3
  ): Promise<SuggestedPaper[]> {
    try {
      logger.info("Finding paper suggestions", { keywords, field, limit });

      const query = keywords.join(" ");
      const currentYear = new Date().getFullYear();

      // Search all APIs in parallel
      const [crossrefPapers, pubmedPapers, arxivPapers] =
        await Promise.allSettled([
          this.searchCrossRef(query, limit * 2),
          field === "medicine" || field === "biology"
            ? this.searchPubMed(query, limit * 2)
            : Promise.resolve([]),
          field === "computer_science" ||
          field === "physics" ||
          field === "mathematics"
            ? this.searchArxiv(query, limit * 2)
            : Promise.resolve([]),
        ]);

      // Combine results
      const allPapers: Paper[] = [
        ...(crossrefPapers.status === "fulfilled" ? crossrefPapers.value : []),
        ...(pubmedPapers.status === "fulfilled" ? pubmedPapers.value : []),
        ...(arxivPapers.status === "fulfilled" ? arxivPapers.value : []),
      ];

      // Deduplicate
      const uniquePapers = this.deduplicatePapers(allPapers);

      // Filter recent papers (last 3 years)
      const recentPapers = uniquePapers.filter(
        (paper) => paper.year >= currentYear - 3
      );

      // Rank by relevance
      const rankedPapers = this.rankPapers(recentPapers, keywords);

      // Format and return top results
      const suggestions = rankedPapers.slice(0, limit).map((paper) => ({
        ...paper,
        citation: this.formatCitation(paper, "APA"),
      }));

      logger.info(`Found ${suggestions.length} paper suggestions`);

      return suggestions;
    } catch (error: any) {
      logger.error("Error suggesting papers", { error: error.message });
      throw new Error(`Failed to suggest papers: ${error.message}`);
    }
  }

  /**
   * Search CrossRef API
   */
  private static async searchCrossRef(
    query: string,
    limit: number
  ): Promise<Paper[]> {
    try {
      const response = await axios.get(this.CROSSREF_API, {
        params: {
          query,
          rows: limit,
          sort: "published",
          order: "desc",
          filter: "type:journal-article",
        },
        timeout: 5000,
      });

      if (!response.data?.message?.items) {
        return [];
      }

      return response.data.message.items.map((item: any) => {
        let year =
          item.published?.["date-parts"]?.[0]?.[0] || new Date().getFullYear();
        // Sanity check for future years
        if (year > new Date().getFullYear() + 1) {
          year = new Date().getFullYear();
        }
        return {
          title: item.title?.[0] || "Untitled",
          authors:
            item.author
              ?.map((a: any) => {
                const given = a.given || "";
                const family = a.family || "";
                const name = `${given} ${family}`.trim();
                return name || "Unknown";
              })
              .filter((name: string) => name !== "Unknown") || [],
          year,
          doi: item.DOI,
          abstract: item.abstract || undefined,
          citationCount: item["is-referenced-by-count"] || 0,
          journal: item["container-title"]?.[0] || undefined,
          url: item.URL || `https://doi.org/${item.DOI}`,
          source: "crossref" as const,
        };
      });
    } catch (error: any) {
      logger.warn("CrossRef search failed", { error: error.message });
      return [];
    }
  }

  /**
   * Search PubMed API
   */
  private static async searchPubMed(
    query: string,
    limit: number
  ): Promise<Paper[]> {
    try {
      // Step 1: Search for IDs
      const searchResponse = await axios.get(
        `${this.PUBMED_API}/esearch.fcgi`,
        {
          params: {
            db: "pubmed",
            term: query,
            retmax: limit,
            sort: "pub_date",
            retmode: "json",
          },
          timeout: 5000,
        }
      );

      const ids = searchResponse.data?.esearchresult?.idlist || [];
      if (ids.length === 0) {
        return [];
      }

      // Step 2: Fetch details
      const detailsResponse = await axios.get(
        `${this.PUBMED_API}/esummary.fcgi`,
        {
          params: {
            db: "pubmed",
            id: ids.join(","),
            retmode: "json",
          },
          timeout: 5000,
        }
      );

      const results = detailsResponse.data?.result || {};

      return ids
        .map((id: string) => {
          const item = results[id];
          if (!item) return null;

          return {
            title: item.title || "Untitled",
            authors: item.authors?.map((a: any) => a.name) || [],
            year:
              parseInt(item.pubdate?.split(" ")[0]) || new Date().getFullYear(),
            doi: item.elocationid?.replace("doi: ", "") || undefined,
            journal: item.source || undefined,
            url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
            source: "pubmed" as const,
          };
        })
        .filter(Boolean) as Paper[];
    } catch (error: any) {
      logger.warn("PubMed search failed", { error: error.message });
      return [];
    }
  }

  /**
   * Search Arxiv API
   */
  private static async searchArxiv(
    query: string,
    limit: number
  ): Promise<SuggestedPaper[]> {
    try {
      const response = await axios.get(this.ARXIV_API, {
        params: {
          search_query: `all:${query}`,
          max_results: limit,
          sortBy: "submittedDate",
          sortOrder: "descending",
        },
        timeout: 5000,
      });

      // Parse XML response
      const entries = this.parseArxivXML(response.data);

      return entries;
    } catch (error: any) {
      logger.warn("Arxiv search failed", { error: error.message });
      return [];
    }
  }

  /**
   * Parse Arxiv XML response
   */
  private static parseArxivXML(xml: string): SuggestedPaper[] {
    try {
      const entries: SuggestedPaper[] = [];
      const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
      let match;

      while ((match = entryRegex.exec(xml)) !== null) {
        const entry = match[1];

        const title =
          entry.match(/<title>(.*?)<\/title>/)?.[1]?.trim() || "Untitled";
        const published =
          entry.match(/<published>(.*?)<\/published>/)?.[1] || "";
        const year =
          parseInt(published.split("-")[0]) || new Date().getFullYear();
        const id = entry.match(/<id>(.*?)<\/id>/)?.[1] || "";
        const summary = entry.match(/<summary>(.*?)<\/summary>/)?.[1]?.trim();

        // Extract authors
        const authorMatches = entry.matchAll(/<name>(.*?)<\/name>/g);
        const authors = Array.from(authorMatches).map((m) => m[1].trim());

        entries.push({
          title,
          authors,
          year,
          abstract: summary,
          url: id,
          source: "arxiv" as const,
          relevanceScore: 0, // Default relevance score
          citation: "", // Will be populated later
        });
      }

      return entries;
    } catch (error: any) {
      logger.error("Error parsing Arxiv XML", { error: error.message });
      return [];
    }
  }

  /**
   * Deduplicate papers based on title similarity
   */
  private static deduplicatePapers(papers: Paper[]): Paper[] {
    const seen = new Set<string>();
    const unique: Paper[] = [];

    for (const paper of papers) {
      const key = paper.doi || paper.title.toLowerCase().replace(/\s+/g, "");

      if (!seen.has(key)) {
        seen.add(key);
        unique.push(paper);
      }
    }

    return unique;
  }

  /**
   * Rank papers by relevance
   */
  private static rankPapers(
    papers: Paper[],
    keywords: string[]
  ): SuggestedPaper[] {
    return papers
      .map((paper) => ({
        ...paper,
        relevanceScore: this.calculateRelevance(paper, keywords),
        citation: "",
        source: (paper as any).source || "crossref",
      }))
      .sort((a, b) => {
        // Sort by relevance, then citation count, then year
        if (Math.abs(a.relevanceScore - b.relevanceScore) > 5) {
          return b.relevanceScore - a.relevanceScore;
        }
        if (Math.abs((a.citationCount || 0) - (b.citationCount || 0)) > 10) {
          return (b.citationCount || 0) - (a.citationCount || 0);
        }
        return b.year - a.year;
      });
  }

  /**
   * Calculate relevance score
   */
  private static calculateRelevance(paper: Paper, keywords: string[]): number {
    let score = 0;
    const title = paper.title.toLowerCase();
    const abstract = (paper.abstract || "").toLowerCase();

    // Title matches (high weight)
    keywords.forEach((keyword) => {
      if (title.includes(keyword.toLowerCase())) {
        score += 30;
      }
    });

    // Abstract matches (medium weight)
    keywords.forEach((keyword) => {
      if (abstract.includes(keyword.toLowerCase())) {
        score += 10;
      }
    });

    // Citation count bonus (capped at 20)
    score += Math.min(20, (paper.citationCount || 0) / 10);

    // Recency bonus
    const age = new Date().getFullYear() - paper.year;
    if (age === 0) score += 15;
    else if (age === 1) score += 10;
    else if (age === 2) score += 5;

    return Math.min(100, score);
  }

  /**
   * Format citation in APA style
   */
  private static formatCitation(paper: Paper, style: string = "APA"): string {
    const authors = paper.authors.slice(0, 3).join(", ");
    const moreAuthors = paper.authors.length > 3 ? ", et al." : "";

    if (style === "APA") {
      return `${authors}${moreAuthors} (${paper.year}). ${paper.title}. ${paper.journal || ""}${paper.doi ? ` https://doi.org/${paper.doi}` : ""}`;
    }

    // Default format
    return `${authors}${moreAuthors}. "${paper.title}." ${paper.year}.`;
  }
}
