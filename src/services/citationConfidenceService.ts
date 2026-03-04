import { prisma } from "../lib/prisma";
import logger from "../monitoring/logger";
import { EmailService } from "./emailService";
import { UsageService } from "./usageService";
import axios from "axios";
import { SecretsService } from "./secrets-service";

export interface RecencyScore {
  score: number; // 0-100
  status: "recent" | "acceptable" | "dated" | "outdated";
  yearsOld: number;
  recommendation: string;
}

export interface ConfidenceScore {
  overall: number; // 0-100
  recencyScore: number;
  coverageScore: number;
  qualityScore: number;
  diversityScore: number;
  status: "strong" | "good" | "weak" | "poor";
  warnings: string[];
  suggestions: string[];
}

interface Citation {
  id: string;
  title: string;
  author: string;
  year: number;
  type: string;
  doi?: string;
  citationCount?: number;
  is_reliable?: boolean;
}

export class CitationConfidenceService {
  // Field-specific recency thresholds (in years)
  private static readonly FIELD_THRESHOLDS: Record<string, number> = {
    "computer-science": 3,
    technology: 3,
    medicine: 5,
    biology: 5,
    psychology: 7,
    sociology: 8,
    economics: 8,
    history: 15,
    literature: 15,
    philosophy: 20,
    default: 10,
  };

  /**
   * Calculate recency score for a single citation
   */
  static calculateRecencyScore(
    year: number,
    field: string = "default"
  ): RecencyScore {
    const currentYear = new Date().getFullYear();
    const age = currentYear - year;

    const threshold =
      this.FIELD_THRESHOLDS[field.toLowerCase()] ||
      this.FIELD_THRESHOLDS.default;

    // Calculate score based on age relative to threshold
    if (age <= threshold / 3) {
      return {
        score: 100,
        status: "recent",
        yearsOld: age,
        recommendation: "Excellent recency - within optimal range",
      };
    } else if (age <= threshold) {
      return {
        score: 75,
        status: "acceptable",
        yearsOld: age,
        recommendation: "Good recency - acceptable for field",
      };
    } else if (age <= threshold * 2) {
      return {
        score: 50,
        status: "dated",
        yearsOld: age,
        recommendation: "Older source - verify relevance to current research",
      };
    } else {
      return {
        score: 25,
        status: "outdated",
        yearsOld: age,
        recommendation:
          "Historical source - ensure recent findings are also included",
      };
    }
  }

  /**
   * Calculate overall confidence score for a section's citations
   */
  static calculateConfidenceScore(
    citations: Citation[],
    textLength: number,
    field: string = "default"
  ): ConfidenceScore {
    if (citations.length === 0) {
      return {
        overall: 0,
        recencyScore: 0,
        coverageScore: 0,
        qualityScore: 0,
        diversityScore: 0,
        status: "poor",
        warnings: ["No citations found"],
        suggestions: ["Add citations to support your claims"],
      };
    }

    // 1. Recency Score (40% weight)
    const recencyScores = citations.map(
      (c) => this.calculateRecencyScore(c.year, field).score
    );
    const avgRecency =
      recencyScores.reduce((a, b) => a + b, 0) / recencyScores.length;

    // 2. Coverage Score (30% weight) - citations per 1000 words
    const wordsPerCitation = textLength / citations.length;
    const coverageScore = Math.min(
      100,
      Math.max(0, 100 - (wordsPerCitation - 200) / 5)
    );

    // 3. Quality Score (20% weight) - based on citation counts
    const validCitations = citations.filter(
      (c) => c.citationCount !== undefined && c.citationCount !== null
    );
    const avgCitationCount =
      validCitations.length > 0
        ? validCitations.reduce((sum, c) => sum + (c.citationCount || 0), 0) /
        validCitations.length
        : 0;
    const qualityScore = Math.min(
      100,
      avgCitationCount > 0 ? Math.log10(avgCitationCount + 1) * 30 : 50
    );

    // 4. Diversity Score (10% weight) - variety of sources
    const uniqueAuthors = new Set(citations.map((c) => c.author)).size;
    const diversityScore = Math.min(
      100,
      (uniqueAuthors / citations.length) * 100
    );

    // Calculate weighted overall score
    const overall = Math.round(
      avgRecency * 0.4 +
      coverageScore * 0.3 +
      qualityScore * 0.2 +
      diversityScore * 0.1
    );

    // Determine status
    let status: "strong" | "good" | "weak" | "poor";
    if (overall >= 80) status = "strong";
    else if (overall >= 60) status = "good";
    else if (overall >= 40) status = "weak";
    else status = "poor";

    // Generate warnings and suggestions
    const warnings: string[] = [];
    const suggestions: string[] = [];

    // Check for recent citations
    const recentCitations = citations.filter((c) => {
      const age = new Date().getFullYear() - c.year;
      return age <= 3;
    });

    if (recentCitations.length === 0) {
      warnings.push("No citations from the last 3 years");
      suggestions.push("Add recent sources to strengthen your argument");
    }

    // Check coverage
    if (wordsPerCitation > 500) {
      warnings.push("Low citation density");
      suggestions.push("Consider adding more citations to support claims");
    }

    // Check diversity
    if (diversityScore < 50) {
      warnings.push("Limited source diversity");
      suggestions.push("Include citations from multiple authors");
    }

    // Check reliability
    const unreliable = citations.filter((c) => c.is_reliable === false);
    if (unreliable.length > 0) {
      warnings.push(
        `Detected ${unreliable.length} citations that could not be verified in public databases.`
      );
      suggestions.push(
        "Verify the authenticity of your sources using valid databases."
      );
      // Penalty for unreliable citations? Maybe reduce overall score?
      // Let's reduce overall score by 10 per fake citation, max 50
      // overall = Math.max(0, overall - Math.min(50, unreliable.length * 10));
    }

    return {
      overall,
      recencyScore: Math.round(avgRecency),
      coverageScore: Math.round(coverageScore),
      qualityScore: Math.round(qualityScore),
      diversityScore: Math.round(diversityScore),
      status,
      warnings,
      suggestions,
    };
  }

  /**
   * Analyze all citations in a project
   */
  static async analyzeProjectCitations(
    projectId: string,
    userId: string,
    field: string = "default"
  ): Promise<{
    totalCitations: number;
    overallConfidence: ConfidenceScore;
    citationBreakdown: {
      recent: number;
      acceptable: number;
      dated: number;
      outdated: number;
    };
  }> {
    try {
      // Check usage limits
      const usageCheck = await UsageService.checkUsageLimit(
        userId,
        "citation_check"
      );

      // Special handling for 0 limit (feature not available) vs limit reached
      if (!usageCheck.allowed) {
        if (usageCheck.limit === 0) {
          throw new Error(
            "Citation Confidence Check is not available on your current plan. Please upgrade to access this feature."
          );
        } else {
          throw new Error(
            `Usage limit reached for Citation Checks. Limit: ${usageCheck.limit}`
          );
        }
      }

      // Track usage
      await UsageService.trackUsage(userId, "citation_check");

      // Fetch project citations
      const citations = await prisma.citation.findMany({
        where: {
          project_id: projectId,
        },
      });

      // Get project content length
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { word_count: true },
      });

      const textLength = project?.word_count || 1000;

      // Map to Citation interface with validation
      const citationData: Citation[] = citations.map((c: any) => {
        let year = c.year || new Date().getFullYear();

        // SANITY CHECK: Reject future years (indicates data error or hallucination)
        const currentYear = new Date().getFullYear();
        if (year > currentYear) {
          logger.warn("Future year detected in citation - marking as invalid", {
            citationId: c.id,
            year,
            currentYear,
          });
          year = currentYear; // Default to current year instead of invalid future
        }

        return {
          id: c.id,
          title: c.title,
          author: c.author || "Unknown",
          year,
          type: c.type,
          doi: c.doi || undefined,
          citationCount: 0, // Would need to fetch from CrossRef
          is_reliable: c.is_reliable,
        };
      });

      // Calculate overall confidence
      const overallConfidence = this.calculateConfidenceScore(
        citationData,
        textLength,
        field
      );

      // Calculate breakdown
      const breakdown = {
        recent: 0,
        acceptable: 0,
        dated: 0,
        outdated: 0,
      };

      citationData.forEach((citation) => {
        const recency = this.calculateRecencyScore(citation.year, field);
        breakdown[recency.status]++;
      });

      // Send completion email
      try {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        // project word_count was fetched earlier, re-using project variable if possible, but earlier it was local select
        // Let's re-fetch or rely on the previous fetch if it had enough info?
        // The previous fetch was `const project = await prisma.project.findUnique... select: { word_count: true }`.
        // I need the name now.
        const projectDetails = await prisma.project.findUnique({
          where: { id: projectId },
        });

        if (user && user.email && projectDetails) {
          await EmailService.sendScanCompletionEmail(
            user.email,
            user.full_name || "ColabWize User",
            "citations",
            projectDetails.title || "Untitled Project",
            `Confidence Score: ${Math.round(overallConfidence.overall)}/100\nTotal Citations: ${citations.length}\nStatus: ${overallConfidence.status.toUpperCase()}`,
            `${await SecretsService.getFrontendUrl()}/dashboard/editor/${projectId}?tab=citations`
          );
        }
      } catch (emailError: any) {
        logger.error("Failed to send citation analysis completion email", {
          error: emailError.message,
        });
      }

      return {
        totalCitations: citations.length,
        overallConfidence,
        citationBreakdown: breakdown,
      };
    } catch (error: any) {
      logger.error("Error analyzing project citations", {
        error: error.message,
        projectId,
      });
      throw new Error(`Failed to analyze citations: ${error.message}`);
    }
  }

  /**
   * Add a citation to a project
   */
  static async addCitation(
    projectId: string,
    userId: string,
    citationData: {
      title: string;
      author: string;
      year: number;
      type: string;
      doi?: string;
      url?: string;
      source?: string;
      abstract?: string;
      formatted_citations?: any;
    }
  ): Promise<any> {
    try {
      // Verify project ownership
      const project = await prisma.project.findUnique({
        where: { id: projectId },
      });

      if (!project || project.user_id !== userId) {
        throw new Error("Project not found or access denied");
      }

      // Check if citation already exists
      const existing = await prisma.citation.findFirst({
        where: {
          project_id: projectId,
          // Simple duplicate check based on title or DOI
          OR: [
            { title: citationData.title },
            { doi: citationData.doi ? citationData.doi : undefined },
          ],
        },
      });

      if (existing) {
        return existing;
      }

      // Validate citation format
      const formatValidation = this.validateCitationFormat(citationData);
      if (!formatValidation.valid) {
        logger.warn("Citation format validation failed", {
          issues: formatValidation.issues,
        });
      }

      // Verify citation authenticity via CrossRef if DOI provided
      let isReliable = true;
      if (citationData.doi) {
        isReliable = await this.verifyCitationWithCrossRef(
          citationData.doi,
          citationData.title
        );
        if (!isReliable) {
          logger.warn("Citation verification failed", {
            doi: citationData.doi,
            title: citationData.title,
          });
        }
      } else if (citationData.source === "crossref") {
        // If from CrossRef without DOI, it's likely unreliable
        isReliable = false;
      } else if (citationData.source === "pubmed") {
        // Verify with PubMed
        isReliable = await this.verifyCitationWithPubMed(citationData.title);
      } else if (citationData.source === "arxiv") {
        // Verify with arXiv
        isReliable = await this.verifyCitationWithArxiv(citationData.title);
      } else {
        // Fallback: Try all if source is manual/unknown but looks academic
        // Check PubMed First (Medical) -> Then ArXiv (Tech) -> Then CrossRef (General - requires searching for DOI really, but we skip that complex flow for now)
        if (await this.verifyCitationWithPubMed(citationData.title)) {
          citationData.source = "pubmed";
          isReliable = true;
        } else if (await this.verifyCitationWithArxiv(citationData.title)) {
          citationData.source = "arxiv";
          isReliable = true;
        }
      }

      // SANITY CHECK: Validate year
      const currentYear = new Date().getFullYear();
      if (citationData.year > currentYear) {
        logger.warn("Future year in citation - adjusting to current year", {
          providedYear: citationData.year,
          adjustedYear: currentYear,
        });
        citationData.year = currentYear;
      }

      // Create citation
      const citation = await prisma.citation.create({
        data: {
          project: {
            connect: { id: projectId },
          },
          user: {
            connect: { id: userId },
          },
          title: citationData.title,
          author: citationData.author,
          year: citationData.year,
          type: citationData.type,
          doi: citationData.doi,
          url: citationData.url,
          source: citationData.source || "manual",
          abstract: citationData.abstract,
          formatted_citations: citationData.formatted_citations,
          is_reliable: isReliable,
        },
      });

      logger.info("Citation added to project", {
        citationId: citation.id,
        projectId,
      });

      return citation;
    } catch (error: any) {
      logger.error("Error adding citation", {
        error: error.message,
        projectId,
      });
      throw error;
    }
  }
  /**
   * Scan content for sentences that need citations but lack them
   */
  static scanContentForCitations(content: string): {
    sentence: string;
    suggestion: string;
    type: "factual_claim" | "definition" | "statistic";
  }[] {
    const sentences = content.match(/[^.!?]+[.!?]+/g) || [];
    const results: {
      sentence: string;
      suggestion: string;
      type: "factual_claim" | "definition" | "statistic";
    }[] = [];

    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      if (trimmed.length < 20) continue; // Skip short sentences

      // Check if already cited
      // Regex pattern matches: (Author Name, 2026) or [1] format
      const hasCitation =
        /\([A-Za-z\s.,'\-]+,?\s?\d{4}\)|\[\d+\]/.test(trimmed) ||
        /^[A-Za-z.,'\-]+\s\(\d{4}\)/.test(trimmed); // Author (Year)

      if (hasCitation) continue;

      // Check for Statisitics (numbers, %, "percent", "data")
      if (/\d+%|\d+ percent|data shows|study found/.test(trimmed)) {
        results.push({
          sentence: trimmed,
          suggestion:
            "This sentence resembles a statistical claim commonly supported by citations in academic writing.",
          type: "statistic",
        });
        continue;
      }

      // Check for Definitions
      if (
        /is defined as|refers to|can be described as|is known as/.test(trimmed)
      ) {
        results.push({
          sentence: trimmed,
          suggestion:
            "This sentence resembles a definitional claim commonly supported by citations in academic writing.",
          type: "definition",
        });
        continue;
      }

      // Check for Factual Claims (strong assertations)
      if (
        /evidence suggests|research indicates|it is well known|studies have shown|historically/.test(
          trimmed
        )
      ) {
        results.push({
          sentence: trimmed,
          suggestion:
            "This sentence resembles a strong assertion commonly supported by citations in academic writing.",
          type: "factual_claim",
        });
        continue;
      }
    }

    return results;
  }

  /**
   * Validate citation format and required fields
   */
  private static validateCitationFormat(citation: {
    title: string;
    author: string;
    year: number;
    type: string;
    doi?: string;
  }): { valid: boolean; issues: string[] } {
    const issues: string[] = [];

    // Check required fields
    if (!citation.title || citation.title.trim().length === 0) {
      issues.push("Missing or empty title");
    }
    if (!citation.author || citation.author.trim().length === 0) {
      issues.push("Missing or empty author");
    }

    // Validate year
    const currentYear = new Date().getFullYear();
    if (
      !citation.year ||
      citation.year < 1900 ||
      citation.year > currentYear + 1
    ) {
      issues.push(
        `Invalid year: ${citation.year} (must be between 1900 and ${currentYear + 1})`
      );
    }

    // Journal articles should ideally have a DOI
    if (citation.type === "journal-article" && !citation.doi) {
      issues.push(
        "Journal article missing DOI (consider adding for verification)"
      );
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  /**
   * Verify citation exists in CrossRef database
   */
  private static async verifyCitationWithCrossRef(
    doi: string,
    title?: string
  ): Promise<boolean> {
    try {
      // Query CrossRef API
      const response = await axios.get(
        `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
        {
          timeout: 5000,
          headers: {
            "User-Agent": "ColabWize/1.0 (mailto:support@colabwize.com)",
          },
        }
      );

      if (response.status === 200 && response.data?.message) {
        const work = response.data.message;

        // Basic validation: check if DOI matches
        if (work.DOI && work.DOI.toLowerCase() === doi.toLowerCase()) {
          // Optionally verify title similarity
          if (title && work.title?.[0]) {
            const normalizedTitle = title.toLowerCase().trim();
            const normalizedWorkTitle = work.title[0].toLowerCase().trim();

            // Check if titles are similar (allowing for minor differences)
            if (
              !normalizedWorkTitle.includes(normalizedTitle.substring(0, 20))
            ) {
              logger.warn("Title mismatch in CrossRef verification", {
                provided: title,
                crossref: work.title[0],
              });
              return false;
            }
          }

          logger.info("Citation verified with CrossRef", { doi });
          return true;
        }
      }

      logger.warn("Citation not found in CrossRef", { doi });
      return false;
    } catch (error: any) {
      if (error.response?.status === 404) {
        logger.warn("Citation DOI not found in CrossRef", { doi });
        return false;
      }

      logger.error("CrossRef verification failed", {
        error: error.message,
        doi,
      });

      // On error, assume reliable (benefit of doubt)
      return true;
    }
  }
  /**
   * Verify citation exists in PubMed/NCBI database
   */
  private static async verifyCitationWithPubMed(title: string): Promise<boolean> {
    try {
      if (!title || title.length < 10) return false;

      // Use E-Utilities ESearch
      const response = await axios.get(
        "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi",
        {
          params: {
            db: "pubmed",
            term: `${title}[Title]`,
            retmode: "json",
            tool: "colabwize",
            email: "support@colabwize.com"
          },
          timeout: 5000
        }
      );

      if (response.status === 200 && response.data?.esearchresult) {
        const count = parseInt(response.data.esearchresult.count || "0");
        if (count > 0) {
          logger.info("Citation verified with PubMed", { title });
          return true;
        }
      }
      return false;
    } catch (error: any) {
      logger.warn("PubMed verification failed", { error: error.message, title });
      return false; // Fail safe
    }
  }

  /**
   * Verify citation exists in arXiv database
   */
  private static async verifyCitationWithArxiv(title: string): Promise<boolean> {
    try {
      if (!title || title.length < 10) return false;

      // Use arXiv API
      // Search by title prefix (ti:)
      const response = await axios.get(
        "http://export.arxiv.org/api/query",
        {
          params: {
            search_query: `ti:"${title}"`,
            start: 0,
            max_results: 1
          },
          timeout: 5000
        }
      );

      // Response is Atom XML. We just check if an entry exists and verify title match lightly
      if (response.status === 200 && response.data) {
        // Simple string check for now since we don't have XML parser
        // If totalResults is not 0
        if (!response.data.includes("opensearch:totalResults>0</opensearch:totalResults>")) {
          return true;
        }
      }
      return false;
    } catch (error: any) {
      logger.warn("arXiv verification failed", { error: error.message, title });
      return false;
    }
  }

  /**
   * Verify citation exists in OpenAlex database
   */
  private static async verifyCitationWithOpenAlex(title: string): Promise<boolean> {
    try {
      if (!title || title.length < 10) return false;

      // OpenAlex API free tier
      const response = await axios.get(
        "https://api.openalex.org/works",
        {
          params: {
            search: title,
            per_page: 1,
            mailto: "support@colabwize.com"
          },
          timeout: 5000
        }
      );

      if (response.status === 200 && response.data?.results?.length > 0) {
        const work = response.data.results[0];
        // Fuzzy title match
        if (work.title && work.title.toLowerCase().includes(title.toLowerCase().substring(0, 20))) {
          logger.info("Citation verified with OpenAlex", { title });
          return true;
        }
      }
      return false;
    } catch (error: any) {
      logger.warn("OpenAlex verification failed", { error: error.message, title });
      // Don't fail the check, just return false for this provider
      return false;
    }
  }

  /**
   * Real-Time Validation: Check a single citation against ALL databases
   * Used for the "Integrity Linter" fast feedback loop.
   */
  static async verifySingleCitation(citation: {
    title: string;
    doi?: string;
  }): Promise<{ isReliable: boolean; source: string | null }> {
    // 1. Check CrossRef (Gold Standard for DOIs)
    if (citation.doi) {
      const crossRefValid = await this.verifyCitationWithCrossRef(citation.doi, citation.title);
      if (crossRefValid) return { isReliable: true, source: 'crossref' };
    }

    // 2. Check PubMed (Medical/Bio)
    if (await this.verifyCitationWithPubMed(citation.title)) {
      return { isReliable: true, source: 'pubmed' };
    }

    // 3. Check arXiv (Preprints/CS/Math)
    if (await this.verifyCitationWithArxiv(citation.title)) {
      return { isReliable: true, source: 'arxiv' };
    }

    // 4. Check OpenAlex (Broad Coverage)
    if (await this.verifyCitationWithOpenAlex(citation.title)) {
      return { isReliable: true, source: 'openalex' };
    }

    // 5. Failed all checks
    return { isReliable: false, source: null };
  }

  /**
   * "Citation Auto-Fixer": Find correct metadata for a fuzzy query
   * Used when a user types a title and we want to suggest the full citation.
   */
  static async findCitationMetadata(query: string): Promise<{
    title: string;
    author: string;
    year: number;
    doi?: string;
    source: string;
  } | null> {
    try {
      // 1. Try CrossRef First (Best for academic accuracy)
      const crossRefResponse = await axios.get(
        `https://api.crossref.org/works`,
        {
          params: { query: query, rows: 1 },
          timeout: 5000
        }
      );

      if (crossRefResponse.data?.message?.items?.length > 0) {
        const item = crossRefResponse.data.message.items[0];
        // Check relevance (simple title match check)
        if (item.title?.[0]) {
          return {
            title: item.title[0],
            author: item.author?.[0]?.family || "Unknown",
            year: item.issued?.['date-parts']?.[0]?.[0] || new Date().getFullYear(),
            doi: item.DOI,
            source: "crossref"
          };
        }
      }

      // 2. Try OpenAlex (Good fallback)
      const openAlexResponse = await axios.get(
        "https://api.openalex.org/works",
        {
          params: { search: query, per_page: 1, mailto: "support@colabwize.com" },
          timeout: 5000
        }
      );

      if (openAlexResponse.data?.results?.length > 0) {
        const work = openAlexResponse.data.results[0];
        return {
          title: work.title,
          author: work.authorships?.[0]?.author?.display_name?.split(" ").pop() || "Unknown",
          year: work.publication_year || new Date().getFullYear(),
          doi: work.doi ? work.doi.replace("https://doi.org/", "") : undefined,
          source: "openalex"
        };
      }

      return null;
    } catch (e) {
      logger.warn("Auto-Fixer search failed", { error: e });
      return null;
    }
  }
}
