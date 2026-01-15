import { prisma } from "../lib/prisma";
import logger from "../monitoring/logger";
import { compareTwoStrings } from "string-similarity";
import { removeStopwords } from "stopword";
import axios from "axios";
import * as crypto from "crypto";
import { EmailService } from "./emailService";
import { SecretsService } from "./secrets-service";

// @ts-ignore
import { pipeline, env } from "@xenova/transformers";

// Configure transformers
env.allowLocalModels = false;
env.useBrowserCache = false;

// Types
export interface OriginalityScanResult {
  id: string;
  projectId: string;
  userId: string;
  overallScore: number;
  classification: "safe" | "review" | "action_required";
  scanStatus: "pending" | "processing" | "completed" | "failed";
  matches: SimilarityMatchResult[];
  scannedAt: Date;
  realityCheck?: RealityCheckStats;
  detailedAnalysis?: DetailedAnalysis;
}

export interface DetailedAnalysis {
  academicSourcesMatch: number;
  webSourcesMatch: number;
  commonPhrasesMatch: number;
  citationPatternMatch: number;
  semanticSimilarity: number;
  syntacticSimilarity: number;
}

export interface RealityCheckStats {
  referencePercent: number;
  commonPhrasePercent: number;
  trustScore: number;
  message: string;
}

export interface SimilarityMatchResult {
  id: string;
  sentenceText: string;
  matchedSource: string;
  sourceUrl?: string;
  sourceDatabase: "web" | "academic" | "journal" | "repository" | "book";
  similarityScore: number;
  positionStart: number;
  positionEnd: number;
  classification:
    | "green"
    | "yellow"
    | "red"
    | "common_phrase"
    | "quoted_correctly"
    | "needs_citation"
    | "close_paraphrase"
    | "safe";
  confidence: number; // 0-100 confidence in this match
}

export interface RephraseResult {
  id: string;
  originalText: string;
  suggestedText: string;
}

export interface DraftComparisonResult {
  similarityScore: number;
  overlapPercentage: number;
  matchedSegments: {
    segment: string;
    similarity: number;
    sourceParams: { start: number; end: number };
    targetParams: { start: number; end: number };
  }[];
  analysis: string;
  isSelfPlagiarismInternal: boolean;
}

class EnhancedTransformerService {
  private static instance: any = null;
  private static rerankInstance: any = null;

  static async getInstance() {
    if (!this.instance) {
      logger.info("Loading enhanced feature-extraction model...");
      // Use a more sophisticated model for better semantic analysis
      this.instance = await pipeline(
        "feature-extraction",
        "Xenova/all-mpnet-base-v2" // Better model than MiniLM
      );
      logger.info("Enhanced model loaded successfully");
    }
    return this.instance;
  }

  static async getRerankInstance() {
    if (!this.rerankInstance) {
      logger.info("Loading cross-encoder re-ranking model...");
      // Cross-encoder model for more accurate sentence-level similarity
      this.rerankInstance = await pipeline(
        "feature-extraction",
        "Xenova/ms-marco-MiniLM-L-6-v2"
      );
      logger.info("Cross-encoder model loaded successfully");
    }
    return this.rerankInstance;
  }
}

class AcademicDatabaseService {
  // API keys will be retrieved via SecretsService

  /**
   * Search academic databases for similar content
   */
  static async searchAcademicDatabases(text: string): Promise<
    Array<{
      title: string;
      authors: string[];
      abstract: string;
      url: string;
      similarity: number;
      database: "crossref" | "semantic_scholar" | "arxiv" | "ieee" | "pubmed";
    }>
  > {
    // Fetch API keys
    const crossrefKey = await SecretsService.getSecret("CROSSREF_API_KEY");
    const semanticScholarKey = await SecretsService.getSecret(
      "SEMANTIC_SCHOLAR_API_KEY"
    );
    const ieeeKey = await SecretsService.getSecret("IEEE_XPLORE_API_KEY");
    const pubmedKey = await SecretsService.getSecret("PUBMED_API_KEY");

    const results: Array<{
      title: string;
      authors: string[];
      abstract: string;
      url: string;
      similarity: number;
      database: "crossref" | "semantic_scholar" | "arxiv" | "ieee" | "pubmed";
    }> = [];

    logger.info("Starting academic database search", {
      hasCrossRefKey: !!crossrefKey,
      hasSemanticScholarKey: !!semanticScholarKey,
      hasIeeeKey: !!ieeeKey,
      hasPubmedKey: !!pubmedKey,
    });

    // Search CrossRef
    try {
      const crossrefResults = await this.searchCrossRef(text, crossrefKey);
      results.push(...crossrefResults);
    } catch (error) {
      logger.warn("CrossRef search failed", {
        error: (error as Error).message,
      });
    }

    // Search Semantic Scholar (requires API key)
    if (semanticScholarKey) {
      try {
        const semanticResults = await this.searchSemanticScholar(
          text,
          semanticScholarKey
        );
        results.push(...semanticResults);
      } catch (error) {
        logger.warn("Semantic Scholar search failed", {
          error: (error as Error).message,
        });
      }
    } else {
      logger.info(
        "Semantic Scholar API key not provided, skipping this source"
      );
    }

    // Search arXiv
    try {
      const arxivResults = await this.searchArXiv(text);
      results.push(...arxivResults);
    } catch (error) {
      logger.warn("arXiv search failed", { error: (error as Error).message });
    }

    // Search IEEE Xplore
    try {
      const ieeeResults = await this.searchIEEE(text, ieeeKey);
      results.push(...ieeeResults);
    } catch (error) {
      logger.warn("IEEE Xplore search failed", {
        error: (error as Error).message,
      });
    }

    // Search PubMed
    try {
      const pubmedResults = await this.searchPubMed(text, pubmedKey);
      results.push(...pubmedResults);
    } catch (error) {
      logger.warn("PubMed search failed", { error: (error as Error).message });
    }

    return results;
  }

  private static async searchCrossRef(
    text: string,
    apiKey: string | null
  ): Promise<
    Array<{
      title: string;
      authors: string[];
      abstract: string;
      url: string;
      similarity: number;
      database: "crossref" | "semantic_scholar" | "arxiv" | "ieee" | "pubmed";
    }>
  > {
    // Extract key phrases from text for better search
    const query = text.substring(0, 200); // Limit query length

    try {
      const response = await axios.get("https://api.crossref.org/works", {
        params: {
          query: query,
          rows: 5,
          select: "title,author,abstract,DOI",
        },
        headers: apiKey
          ? { "Crossref-Plus-API-Token": `Bearer ${apiKey}` }
          : {},
        timeout: 10000,
      });

      if (
        response.data &&
        response.data.message &&
        response.data.message.items
      ) {
        return response.data.message.items
          .map((item: any) => ({
            title: Array.isArray(item.title)
              ? item.title[0] || ""
              : item.title || "",
            authors: Array.isArray(item.author)
              ? item.author.map((auth: any) =>
                  `${auth.family || ""} ${auth.given || ""}`.trim()
                )
              : [],
            abstract: item.abstract || "",
            url: `https://doi.org/${item.DOI}`,
            similarity: this.calculateTextSimilarity(
              text,
              `${Array.isArray(item.title) ? item.title[0] || "" : item.title || ""} ${item.abstract || ""}`
            ),
            database: "crossref" as const,
          }))
          .filter((item: any) => item.similarity > 0.3); // Only return items with significant similarity
      }
    } catch (error) {
      logger.warn("CrossRef API error", { error: (error as Error).message });
    }

    return [];
  }

  private static async searchSemanticScholar(
    text: string,
    apiKey: string
  ): Promise<
    Array<{
      title: string;
      authors: string[];
      abstract: string;
      url: string;
      similarity: number;
      database: "crossref" | "semantic_scholar" | "arxiv" | "ieee" | "pubmed";
    }>
  > {
    const query = encodeURIComponent(text.substring(0, 200));

    try {
      const response = await axios.get(
        `https://api.semanticscholar.org/graph/v1/paper/search`,
        {
          params: {
            query: query,
            limit: 5,
          },
          headers: apiKey ? { "x-api-key": apiKey } : {},
          timeout: 10000,
        }
      );

      if (response.data && response.data.data) {
        return response.data.data
          .map((paper: any) => ({
            title: paper.title || "",
            authors: paper.authors
              ? paper.authors.map((auth: any) => auth.name)
              : [],
            abstract: paper.abstract || "",
            url: paper.url || "",
            similarity: this.calculateTextSimilarity(
              text,
              `${paper.title || ""} ${paper.abstract || ""}`
            ),
            database: "semantic_scholar" as const,
          }))
          .filter((item: any) => item.similarity > 0.3);
      }
    } catch (error) {
      logger.warn("Semantic Scholar API error", {
        error: (error as Error).message,
      });
    }

    return [];
  }

  private static async searchArXiv(text: string): Promise<
    Array<{
      title: string;
      authors: string[];
      abstract: string;
      url: string;
      similarity: number;
      database: "crossref" | "semantic_scholar" | "arxiv" | "ieee" | "pubmed";
    }>
  > {
    // arXiv API doesn't require API key
    const query = encodeURIComponent(text.substring(0, 200));

    try {
      const response = await axios.get(`http://export.arxiv.org/api/query`, {
        params: {
          search_query: `ti:${query} OR abs:${query}`,
          max_results: 5,
        },
        timeout: 10000,
      });

      // Simple XML parsing for arXiv response
      const xmlText = response.data;
      const entries = xmlText.match(/<entry>[\s\S]*?<\/entry>/g) || [];

      return entries
        .map((entry: string) => {
          const title =
            entry.match(/<title>[\s\S]*?<\/title>/)?.[1]?.trim() || "";
          const summary =
            entry.match(/<summary>[\s\S]*?<\/summary>/)?.[1]?.trim() || "";
          const id = entry.match(/<id>[\s\S]*?<\/id>/)?.[1]?.trim() || "";

          // Extract authors
          const authorMatches = entry.matchAll(
            /<name>(.*?)<\/name>/g
          ) as IterableIterator<RegExpMatchArray>;
          const authors = Array.from(authorMatches, (match) => match[1]);

          return {
            title,
            authors,
            abstract: summary,
            url: id,
            similarity: this.calculateTextSimilarity(
              text,
              `${title} ${summary}`
            ),
            database: "arxiv" as const,
          };
        })
        .filter((item: any) => item.similarity > 0.3);
    } catch (error) {
      logger.warn("arXiv API error", { error: (error as Error).message });
    }

    return [];
  }

  private static async searchIEEE(
    text: string,
    apiKey: string | null
  ): Promise<
    Array<{
      title: string;
      authors: string[];
      abstract: string;
      url: string;
      similarity: number;
      database: "crossref" | "semantic_scholar" | "arxiv" | "ieee" | "pubmed";
    }>
  > {
    if (!apiKey) {
      logger.warn("IEEE Xplore API key not configured");
      return [];
    }

    const query = encodeURIComponent(text.substring(0, 200));

    try {
      const response = await axios.post(
        "https://ieeexploreapi.ieee.org/api/v1/search/articles",
        {
          queryText: text.substring(0, 200),
          apiKey: apiKey,
          maxRecords: 5,
          startIndex: 0,
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 10000,
        }
      );

      if (response.data && response.data.data) {
        return response.data.data
          .map((article: any) => ({
            title: article.title || "",
            authors: article.authors
              ? article.authors.map((auth: any) => auth.full_name || "")
              : [],
            abstract: article.abstract || "",
            url: article.html_url || "",
            similarity: this.calculateTextSimilarity(
              text,
              `${article.title || ""} ${article.abstract || ""}`
            ),
            database: "ieee" as const,
          }))
          .filter((item: any) => item.similarity > 0.3);
      }
    } catch (error) {
      logger.warn("IEEE Xplore API error", { error: (error as Error).message });
    }

    return [];
  }

  private static async searchPubMed(
    text: string,
    apiKey: string | null
  ): Promise<
    Array<{
      title: string;
      authors: string[];
      abstract: string;
      url: string;
      similarity: number;
      database: "crossref" | "semantic_scholar" | "arxiv" | "ieee" | "pubmed";
    }>
  > {
    const query = encodeURIComponent(text.substring(0, 200));

    try {
      // First, search for PubMed IDs
      const searchResponse = await axios.get(
        "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi",
        {
          params: {
            db: "pubmed",
            term: query,
            retmax: 5,
            retmode: "json",
            api_key: apiKey || undefined,
          },
          timeout: 10000,
        }
      );

      if (
        searchResponse.data &&
        searchResponse.data.esearchresult &&
        searchResponse.data.esearchresult.idlist
      ) {
        const ids = searchResponse.data.esearchresult.idlist;

        if (ids.length > 0) {
          // Fetch details for the found IDs
          const fetchResponse = await axios.get(
            "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi",
            {
              params: {
                db: "pubmed",
                id: ids.join(","),
                retmode: "xml",
                api_key: apiKey || undefined,
              },
              timeout: 10000,
            }
          );

          // Simple XML parsing for PubMed response
          const xmlText = fetchResponse.data;
          const entries =
            xmlText.match(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/g) || [];

          return entries
            .map((entry: string) => {
              const title =
                entry
                  .match(/<ArticleTitle>[\s\S]*?<\/ArticleTitle>/)?.[1]
                  ?.trim() || "";
              const abstract =
                entry
                  .match(/<AbstractText>[\s\S]*?<\/AbstractText>/)?.[1]
                  ?.trim() || "";
              const pmid =
                entry.match(/<PMID>[\s\S]*?<\/PMID>/)?.[1]?.trim() || "";

              // Extract authors
              const authorMatches = entry.matchAll(
                /<LastName>([\s\S]*?)<\/LastName>[\s\S]*?<ForeName>([\s\S]*?)<\/ForeName>/g
              ) as IterableIterator<RegExpMatchArray>;
              const authors = Array.from(
                authorMatches,
                (match) => `${match[2]} ${match[1]}`
              );

              return {
                title,
                authors,
                abstract,
                url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
                similarity: this.calculateTextSimilarity(
                  text,
                  `${title} ${abstract}`
                ),
                database: "pubmed" as const,
              };
            })
            .filter((item: any) => item.similarity > 0.3);
        }
      }
    } catch (error) {
      logger.warn("PubMed API error", { error: (error as Error).message });
    }

    return [];
  }

  private static calculateTextSimilarity(text1: string, text2: string): number {
    if (!text1 || !text2) return 0;

    // Normalize and clean the texts
    const cleanText1 = text1
      .toLowerCase()
      .replace(/[^\w\s]/gi, " ")
      .trim();
    const cleanText2 = text2
      .toLowerCase()
      .replace(/[^\w\s]/gi, " ")
      .trim();

    if (cleanText1.length < 10 || cleanText2.length < 10) {
      return 0;
    }

    // Use string similarity for quick comparison
    return compareTwoStrings(cleanText1, cleanText2);
  }
}

export class EnhancedOriginalityDetectionService {
  // Classification thresholds (per blueprint)
  private static readonly SAFE_THRESHOLD = 24; // 0-24% = Green
  private static readonly REVIEW_THRESHOLD = 49; // 25-49% = Yellow
  // 50%+ = Red (action required)

  /**
   * Enhanced main scan function - scans document for originality with academic database integration
   */
  static async scanDocument(
    projectId: string,
    userId: string,
    content: string,
    plan: string = "free"
  ): Promise<OriginalityScanResult> {
    try {
      logger.info("Starting enhanced originality scan", { projectId, userId });

      // Generate content hash for caching
      const contentHash = this.generateContentHash(content);

      // Check if we've already scanned this exact content
      const existingScan = await prisma.originalityScan.findFirst({
        where: {
          content_hash: contentHash,
          user_id: userId,
        },
        include: {
          matches: true,
        },
      });

      if (existingScan) {
        logger.info("Found cached scan result", { scanId: existingScan.id });
        return this.formatScanResult(existingScan);
      }

      // Create new scan record
      const scan = await prisma.originalityScan.create({
        data: {
          project_id: projectId,
          user_id: userId,
          content_hash: contentHash,
          overall_score: 0,
          classification: "safe",
          scan_status: "processing",
        },
      });

      // Split content into sentences
      const sentences = this.splitIntoSentences(content);
      logger.info(`Processing ${sentences.length} sentences`);

      // Initialize enhanced transformer model
      await EnhancedTransformerService.getInstance();

      // Process each sentence with enhanced detection
      const matches: SimilarityMatchResult[] = [];
      let totalSimilarity = 0;
      let position = 0;

      for (const sentence of sentences) {
        // Skip very short sentences
        if (sentence.trim().length < 20) {
          position += sentence.length;
          continue;
        }

        // Search academic databases for similar content
        const academicMatches =
          await AcademicDatabaseService.searchAcademicDatabases(sentence);

        // Search online for general content
        const webMatches = await this.searchOnline(sentence);

        // Combine and process matches
        const allMatches = [
          ...academicMatches.map((match) => ({
            ...match,
            sourceDatabase: match.database as
              | "academic"
              | "journal"
              | "repository"
              | "book",
          })),
          ...webMatches.map((match) => ({
            title: match.snippet,
            authors: [],
            abstract: "",
            url: match.link,
            similarity: 0, // Will be calculated below
            database: "web" as const,
            sourceDatabase: "web" as const,
          })),
        ];

        if (allMatches.length > 0) {
          // Get the best match
          const bestMatch = allMatches[0];

          // Calculate similarity with the sentence
          const similarity = await this.calculateEnhancedSimilarity(
            sentence,
            bestMatch.title + " " + bestMatch.abstract
          );
          const similarityPercentage = similarity * 100;

          // Only store if similarity is significant (>15% for academic content)
          if (similarityPercentage > 15) {
            const classification = this.classifyMatch(
              similarityPercentage,
              sentence,
              bestMatch.sourceDatabase
            );

            const match = await prisma.similarityMatch.create({
              data: {
                scan_id: scan.id,
                sentence_text: sentence,
                matched_source: bestMatch.title,
                source_url: bestMatch.url,
                similarity_score: similarityPercentage,
                position_start: position,
                position_end: position + sentence.length,
                classification,
              },
            });

            matches.push({
              id: match.id,
              sentenceText: match.sentence_text,
              matchedSource: match.matched_source,
              sourceUrl: match.source_url || undefined,
              sourceDatabase: bestMatch.sourceDatabase,
              similarityScore: match.similarity_score,
              positionStart: match.position_start,
              positionEnd: match.position_end,
              classification: classification as "green" | "yellow" | "red",
              confidence: 90, // High confidence for academic matches
            });

            totalSimilarity += similarityPercentage;
          }
        }

        position += sentence.length;

        // Rate limiting - wait to avoid hitting API limits
        await new Promise((resolve) => setTimeout(resolve, 150));
      }

      // Calculate overall score
      const overallScore =
        matches.length > 0 ? totalSimilarity / matches.length : 0;

      const classification = this.classifyOverall(overallScore);

      // Calculate detailed analysis
      const detailedAnalysis = this.calculateDetailedAnalysis(matches);

      // Update scan with results
      const updatedScan = await prisma.originalityScan.update({
        where: { id: scan.id },
        data: {
          overall_score: overallScore,
          classification,
          scan_status: "completed",
        },
        include: {
          matches: true,
        },
      });

      logger.info("Enhanced scan completed", {
        scanId: scan.id,
        overallScore,
        matchesFound: matches.length,
      });

      // Send completion email
      try {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        const project = await prisma.project.findUnique({
          where: { id: projectId },
        });

        if (user && user.email && project) {
          await EmailService.sendScanCompletionEmail(
            user.email,
            user.full_name || "ColabWize User",
            "originality",
            project.title || "Untitled Project", // Fixed: Using title instead of name
            `Originality Score: ${Math.round(overallScore)}%\nStatus: ${classification
              .split("_")
              .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
              .join(" ")}`,
            `${await SecretsService.getFrontendUrl()}/dashboard/editor/${projectId}?tab=originality`
          );
        }
      } catch (emailError: any) {
        logger.error("Failed to send originality scan completion email", {
          error: emailError.message,
        });
      }

      // Return enhanced result with detailed analysis
      const baseResult = this.formatScanResult(updatedScan);
      return {
        ...baseResult,
        detailedAnalysis,
      };
    } catch (error: any) {
      logger.error("Error in enhanced scanning document", {
        error: error.message,
        projectId,
        userId,
      });
      throw new Error(`Failed to scan document: ${error.message}`);
    }
  }

  /**
   * Calculate enhanced similarity with multiple approaches
   */
  static async calculateEnhancedSimilarity(
    text1: string,
    text2: string
  ): Promise<number> {
    try {
      // 1. Calculate String Similarity (Dice Coefficient)
      const normalized1 = this.normalizeText(text1);
      const normalized2 = this.normalizeText(text2);

      const stringScore = compareTwoStrings(normalized1, normalized2);

      // If string similarity is very high, it's likely a direct copy
      if (stringScore > 0.85) {
        return stringScore;
      }

      // 2. Calculate Semantic Similarity (Enhanced with better model)
      let semanticScore = 0;
      try {
        const extractor = await EnhancedTransformerService.getInstance();
        if (extractor) {
          // Generate embeddings using the enhanced model
          const output1 = await extractor(text1, {
            pooling: "mean",
            normalize: true,
          });
          const output2 = await extractor(text2, {
            pooling: "mean",
            normalize: true,
          });

          const embedding1 = output1.data;
          const embedding2 = output2.data;

          semanticScore = this.cosineSimilarity(embedding1, embedding2);
        }
      } catch (aiError) {
        logger.warn(
          "Failed to calculate enhanced semantic similarity, falling back to string similarity",
          {
            error: aiError,
          }
        );
      }

      // 3. Calculate contextual similarity using cross-encoder (reranking)
      let rerankScore = 0;
      try {
        const reranker = await EnhancedTransformerService.getRerankInstance();
        if (reranker) {
          // For cross-encoder models, we typically use them for re-ranking existing candidates
          // Here we use them for sentence-level similarity scoring
          rerankScore = await reranker(text1, text2, {
            normalize: true,
          });
        }
      } catch (rerankError) {
        logger.warn(
          "Failed to calculate rerank similarity, using other methods",
          {
            error: rerankError,
          }
        );
      }

      // 4. Calculate n-gram similarity for structural analysis
      const ngramScore = this.calculateNGramSimilarity(
        normalized1,
        normalized2
      );

      // 5. Calculate Jaccard similarity for vocabulary overlap
      const jaccardScore = this.calculateJaccardSimilarity(
        normalized1,
        normalized2
      );

      // Weighted combination of all similarity measures
      // Semantic and rerank scores are more important for academic content
      const combinedScore =
        stringScore * 0.15 + // String similarity (lower weight)
        semanticScore * 0.35 + // Semantic similarity (higher weight)
        rerankScore * 0.3 + // Rerank similarity (high weight)
        ngramScore * 0.1 + // N-gram similarity (moderate weight)
        jaccardScore * 0.1; // Jaccard similarity (moderate weight)

      return combinedScore;
    } catch (error: any) {
      logger.error("Error calculating enhanced similarity", {
        error: error.message,
      });
      return 0;
    }
  }

  /**
   * Calculate n-gram similarity between two texts
   */
  private static calculateNGramSimilarity(
    text1: string,
    text2: string,
    n: number = 3
  ): number {
    if (!text1 || !text2) return 0;

    // Generate n-grams
    const getNGrams = (text: string, n: number) => {
      if (text.length < n) return [text];
      const ngrams = [];
      for (let i = 0; i <= text.length - n; i++) {
        ngrams.push(text.substr(i, n));
      }
      return ngrams;
    };

    const ngrams1 = getNGrams(text1, n);
    const ngrams2 = getNGrams(text2, n);

    // Calculate intersection
    const set1 = new Set(ngrams1);
    const set2 = new Set(ngrams2);
    const intersection = Array.from(set1).filter((x) => set2.has(x)).length;

    // Calculate union
    const union = new Set([...Array.from(set1), ...Array.from(set2)]).size;

    return union === 0 ? 0 : intersection / union;
  }

  /**
   * Calculate Jaccard similarity between two texts
   */
  private static calculateJaccardSimilarity(
    text1: string,
    text2: string
  ): number {
    if (!text1 || !text2) return 0;

    // Tokenize texts
    const tokens1 = text1.split(/\s+/);
    const tokens2 = text2.split(/\s+/);

    // Create sets of tokens
    const set1 = new Set(tokens1);
    const set2 = new Set(tokens2);

    // Calculate intersection
    const intersection = Array.from(set1).filter((x) => set2.has(x)).length;

    // Calculate union
    const union = new Set([...Array.from(set1), ...Array.from(set2)]).size;

    return union === 0 ? 0 : intersection / union;
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private static cosineSimilarity(
    vecA: Float32Array,
    vecB: Float32Array
  ): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    // Safety check for zero vectors
    if (normA === 0 || normB === 0) return 0;

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Normalize text for comparison
   */
  private static normalizeText(text: string): string {
    // Convert to lowercase
    let normalized = text.toLowerCase();

    // Remove special characters but keep spaces
    normalized = normalized.replace(/[^\w\s]/g, " ");

    // Remove extra whitespace
    normalized = normalized.replace(/\s+/g, " ").trim();

    // Remove stopwords
    const words = normalized.split(" ");
    const filtered = removeStopwords(words);

    return filtered.join(" ");
  }

  /**
   * Search online for similar content using Google Custom Search API
   */
  private static async searchOnline(
    sentence: string
  ): Promise<Array<{ snippet: string; link: string }>> {
    try {
      const googleApiKey = await SecretsService.getSecret(
        "GOOGLE_CUSTOM_SEARCH_API_KEY"
      );
      const googleSearchEngineId = await SecretsService.getSecret(
        "GOOGLE_SEARCH_ENGINE_ID"
      );

      // Check if API keys are configured
      if (!googleApiKey || !googleSearchEngineId) {
        logger.warn(
          "Google Custom Search API not configured, skipping online search"
        );
        return [];
      }

      // Prepare search query (first 100 chars of sentence)
      const query = sentence.substring(0, 100);

      const response = await axios.get(
        "https://www.googleapis.com/customsearch/v1",
        {
          params: {
            key: googleApiKey,
            cx: googleSearchEngineId,
            q: query,
            num: 3, // Get top 3 results
          },
          timeout: 5000,
        }
      );

      if (response.data.items && response.data.items.length > 0) {
        return response.data.items.map((item: any) => ({
          snippet: item.snippet || "",
          link: item.link || "",
        }));
      }

      return [];
    } catch (error: any) {
      logger.error("Error searching online", { error: error.message });
      return [];
    }
  }

  /**
   * Enhanced classification that considers source database
   */
  private static classifyMatch(
    score: number,
    sentence: string,
    sourceDatabase: string
  ): string {
    const words = sentence.trim().split(/\s+/).length;
    const hasQuotes =
      /^['""']+.*['""']+$/.test(sentence.trim()) ||
      (sentence.includes('"') && sentence.split('"').length > 2);

    // Check for common citation patterns: (Name, Year), [1], ^{1}
    const hasCitation = /\([A-Za-z\s]+,?\s?\d{4}\)|\[\d+\]/.test(sentence);

    // Check for academic language patterns
    const isAcademicLanguage = this.isAcademicLanguage(sentence);

    // Check for passive voice (common in academic writing)
    const hasPassiveVoice = this.hasPassiveVoice(sentence);

    // Check for formal connectors (therefore, however, furthermore, etc.)
    const hasFormalConnectors = this.hasFormalConnectors(sentence);

    // Check for common academic phrases
    const hasAcademicPhrases = this.hasAcademicPhrases(sentence);

    if (hasQuotes) {
      return "quoted_correctly";
    }

    if (words < 10) {
      // Check if it's a common academic phrase even if short
      if (this.isCommonAcademicPhrase(sentence)) {
        return "common_phrase";
      }
      return "common_phrase";
    }

    // Enhanced classification based on multiple factors
    // Calculate a confidence score based on various linguistic features
    let confidenceAdjustment = 0;
    if (isAcademicLanguage) confidenceAdjustment += 5;
    if (hasPassiveVoice) confidenceAdjustment += 3;
    if (hasFormalConnectors) confidenceAdjustment += 3;
    if (hasAcademicPhrases) confidenceAdjustment += 4;

    // Adjust score based on confidence
    const adjustedScore = Math.min(
      100,
      Math.max(0, score + confidenceAdjustment)
    );

    // Higher threshold for academic sources since they are more authoritative
    if (sourceDatabase !== "web") {
      if (adjustedScore > 75) {
        return hasCitation ? "safe" : "needs_citation";
      }
      if (adjustedScore > 40) {
        return "close_paraphrase";
      }
    } else {
      // Standard web source thresholds
      if (adjustedScore > 65) {
        return hasCitation ? "safe" : "needs_citation";
      }
      if (adjustedScore > 28) {
        return "close_paraphrase";
      }
    }

    return "safe";
  }

  /**
   * Check if sentence contains academic language patterns
   */
  private static isAcademicLanguage(sentence: string): boolean {
    const academicIndicators = [
      /\b(according to|based on|furthermore|however|nevertheless|consequently|therefore|thus|similarly|likewise)\b/i,
      /\b(studies show|research indicates|evidence suggests|findings demonstrate)\b/i,
      /\b(analyses|evaluations|assessments|investigations)\b/i,
      /\b(theory|framework|methodology|approach|model)\b/i,
      /\b(significant|substantial|considerable|notable|marked)\b/i,
    ];

    return academicIndicators.some((pattern) => pattern.test(sentence));
  }

  /**
   * Check if sentence has passive voice construction
   */
  private static hasPassiveVoice(sentence: string): boolean {
    // Simple passive voice detection - looks for 'be' verbs followed by past participles
    const passivePatterns = [
      /(is|was|are|were|be|been|being)\s+\w+ed\b/i,
      /(is|was|are|were|be|been|being)\s+\w+n\b/i, // covers irregular past participles like 'written', 'taken'
      /(is|was|are|were|be|been|being)\s+\w+en\b/i, // covers other forms like 'broken', 'spoken'
    ];

    return passivePatterns.some((pattern) => pattern.test(sentence));
  }

  /**
   * Check if sentence contains formal academic connectors
   */
  private static hasFormalConnectors(sentence: string): boolean {
    const formalConnectors =
      /\b(in addition|furthermore|moreover|however|nevertheless|nonetheless|consequently|therefore|thus|as a result|on the other hand|in contrast|similarly|likewise|alternatively|conversely)\b/i;
    return formalConnectors.test(sentence);
  }

  /**
   * Check if sentence contains common academic phrases
   */
  private static hasAcademicPhrases(sentence: string): boolean {
    const academicPhrases =
      /\b(in the literature|according to recent studies|as mentioned above|as noted by|it has been suggested|it can be argued|it should be noted|previous research|current findings|significant implications|research methodology|empirical evidence|statistical analysis)\b/i;
    return academicPhrases.test(sentence);
  }

  /**
   * Check if sentence is a common academic phrase
   */
  private static isCommonAcademicPhrase(sentence: string): boolean {
    const commonAcademicPhrases = [
      "in conclusion",
      "on the other hand",
      "for example",
      "in other words",
      "as a result",
      "due to",
      "because of",
      "such as",
      "for instance",
      "in addition",
      "in particular",
      "in fact",
      "in general",
      "in terms of",
      "with regard to",
      "in accordance with",
      "according to",
      "on the basis of",
      "in light of",
      "it is important to note",
    ];

    const lowerSentence = sentence.toLowerCase().trim();
    return commonAcademicPhrases.some((phrase) =>
      lowerSentence.includes(phrase)
    );
  }

  /**
   * Classify overall scan result
   */
  private static classifyOverall(
    score: number
  ): "safe" | "review" | "action_required" {
    // Enhanced classification with context-aware thresholds
    // Consider the document type and academic nature for better accuracy

    // For academic papers, we may want to be more lenient with certain types of matches
    // but stricter with others (like direct copying)

    // Adjust thresholds based on the average confidence of matches
    // If most matches are low-confidence (paraphrased content), we can be more lenient
    // If most matches are high-confidence (direct copies), we should be stricter

    // Base thresholds
    const SAFE_THRESHOLD = this.SAFE_THRESHOLD;
    const REVIEW_THRESHOLD = this.REVIEW_THRESHOLD;

    // More nuanced classification based on academic context
    if (score <= SAFE_THRESHOLD * 0.8) {
      // Stricter safe zone
      return "safe";
    } else if (score <= SAFE_THRESHOLD * 1.5) {
      // Near-safe zone - check if it's mostly common phrases or properly cited
      return "review";
    } else if (score <= REVIEW_THRESHOLD * 0.9) {
      // Slightly more lenient review zone
      return "review";
    } else {
      return "action_required";
    }
  }

  /**
   * Split text into sentences
   */
  private static splitIntoSentences(text: string): string[] {
    // More sophisticated sentence splitting considering academic writing patterns
    const sentences = text
      .split(/(?<=[.!?])\s+(?=[A-Z])/) // Split on punctuation + space + capital letter
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    return sentences;
  }

  /**
   * Generate content hash for caching
   */
  private static generateContentHash(content: string): string {
    return crypto.createHash("sha256").update(content).digest("hex");
  }

  /**
   * Get scan results by scan ID
   */
  static async getScanResults(
    scanId: string,
    userId: string
  ): Promise<OriginalityScanResult> {
    try {
      const scan = await prisma.originalityScan.findFirst({
        where: {
          id: scanId,
          user_id: userId,
        },
        include: {
          matches: true,
        },
      });

      if (!scan) {
        throw new Error("Scan not found or access denied");
      }

      return this.formatScanResult(scan);
    } catch (error: any) {
      logger.error("Error getting scan results", {
        error: error.message,
        scanId,
      });
      throw new Error(`Failed to get scan results: ${error.message}`);
    }
  }

  /**
   * Get all scans for a project
   */
  static async getProjectScans(
    projectId: string,
    userId: string
  ): Promise<OriginalityScanResult[]> {
    try {
      const scans = await prisma.originalityScan.findMany({
        where: {
          project_id: projectId,
          user_id: userId,
        },
        include: {
          matches: true,
        },
        orderBy: {
          created_at: "desc",
        },
      });

      return scans.map((scan: any) => this.formatScanResult(scan));
    } catch (error: any) {
      logger.error("Error getting project scans", {
        error: error.message,
        projectId,
      });
      throw new Error(`Failed to get project scans: ${error.message}`);
    }
  }

  /**
   * Format scan result for API response
   */
  private static formatScanResult(scan: any): OriginalityScanResult {
    return {
      id: scan.id,
      projectId: scan.project_id,
      userId: scan.user_id,
      overallScore: scan.overall_score,
      classification: scan.classification as
        | "safe"
        | "review"
        | "action_required",
      scanStatus: scan.scan_status as
        | "pending"
        | "processing"
        | "completed"
        | "failed",
      matches: scan.matches
        ? scan.matches.map((match: any) => ({
            id: match.id,
            sentenceText: match.sentence_text,
            matchedSource: match.matched_source,
            sourceUrl: match.source_url || undefined,
            sourceDatabase: "web", // Default, would be enhanced in the actual implementation
            similarityScore: match.similarity_score,
            positionStart: match.position_start,
            positionEnd: match.position_end,
            classification: match.classification as any,
            confidence: 85, // Default confidence
          }))
        : [],
      scannedAt: scan.scanned_at,
      realityCheck: this.calculateRealityCheck(
        scan.matches,
        scan.overall_score
      ),
    };
  }

  /**
   * Calculate detailed analysis metrics
   */
  private static calculateDetailedAnalysis(
    matches: SimilarityMatchResult[]
  ): DetailedAnalysis {
    if (!matches || matches.length === 0) {
      return {
        academicSourcesMatch: 0,
        webSourcesMatch: 0,
        commonPhrasesMatch: 0,
        citationPatternMatch: 0,
        semanticSimilarity: 0,
        syntacticSimilarity: 0,
      };
    }

    let academicMatches = 0;
    let webMatches = 0;
    let commonPhraseMatches = 0;
    let citationPatternMatches = 0;
    let avgSimilarityScore = 0;
    let highSimilarityMatches = 0; // Matches with >70% similarity

    matches.forEach((match) => {
      if (match.sourceDatabase !== "web") {
        academicMatches++;
      } else {
        webMatches++;
      }

      if (match.classification === "common_phrase") {
        commonPhraseMatches++;
      }

      if (
        match.classification === "needs_citation" ||
        match.classification === "quoted_correctly"
      ) {
        citationPatternMatches++;
      }

      // Track similarity metrics
      avgSimilarityScore += match.similarityScore;
      if (match.similarityScore > 70) {
        highSimilarityMatches++;
      }
    });

    // Calculate average similarity across all matches
    const overallAvgSimilarity =
      matches.length > 0 ? avgSimilarityScore / matches.length : 0;

    // Estimate semantic vs syntactic similarity based on match patterns
    const semanticEstimate = Math.min(
      100,
      overallAvgSimilarity * 0.8 + (highSimilarityMatches / matches.length) * 20
    );
    const syntacticEstimate = Math.min(
      100,
      overallAvgSimilarity * 0.6 + (commonPhraseMatches / matches.length) * 40
    );

    return {
      academicSourcesMatch: Math.round(
        (academicMatches / matches.length) * 100
      ),
      webSourcesMatch: Math.round((webMatches / matches.length) * 100),
      commonPhrasesMatch: Math.round(
        (commonPhraseMatches / matches.length) * 100
      ),
      citationPatternMatch: Math.round(
        (citationPatternMatches / matches.length) * 100
      ),
      semanticSimilarity: Math.round(semanticEstimate),
      syntacticSimilarity: Math.round(syntacticEstimate),
    };
  }

  /**
   * Calculate Anxiety Reality Check stats
   */
  private static calculateRealityCheck(
    matches: any[],
    overallScore: number
  ): RealityCheckStats {
    if (!matches || matches.length === 0) {
      return {
        referencePercent: 0,
        commonPhrasePercent: 0,
        trustScore: 100,
        message: "No similarity detected. Your work appears original.",
      };
    }

    const totalMatches = matches.length;
    let referenceCount = 0;
    let commonPhraseCount = 0;

    matches.forEach((m) => {
      if (
        m.classification === "quoted_correctly" ||
        m.classification === "safe"
      )
        referenceCount++;
      if (m.classification === "common_phrase") commonPhraseCount++;
    });

    const referencePercent = Math.round((referenceCount / totalMatches) * 100);
    const commonPhrasePercent = Math.round(
      (commonPhraseCount / totalMatches) * 100
    );

    // Trust score is inverse of "bad" similarity (red/yellow)
    const badMatches = matches.filter(
      (m) =>
        m.classification === "needs_citation" ||
        m.classification === "close_paraphrase"
    ).length;
    const trustScore = Math.max(0, 100 - (badMatches / totalMatches) * 100);

    let message = "Intent + citation matters more than %";
    if (referencePercent > 50) {
      message = "High similarity from references is often acceptable.";
    } else if (commonPhrasePercent > 30) {
      message = "Common phrases are expected in academic writing.";
    } else if (overallScore < 20) {
      message = "Turnitin flags ≠ plagiarism accusation.";
    }

    return {
      referencePercent,
      commonPhrasePercent,
      trustScore: Math.round(trustScore),
      message,
    };
  }

  /**
   * Compare two drafts for self-plagiarism
   */
  static compareDrafts(
    currentDraft: string,
    previousDraft: string
  ): DraftComparisonResult {
    const similarity = compareTwoStrings(currentDraft, previousDraft);
    const score = Math.round(similarity * 100);

    // Find overlapping segments (simplified logic: check for shared sentences)
    const currentSentences = this.splitIntoSentences(currentDraft);
    const previousSentences = this.splitIntoSentences(previousDraft);

    const matchedSegments = [];
    let overlapCount = 0;

    for (let cSentence of currentSentences) {
      if (cSentence.length < 20) continue; // Skip short ones

      // Find best match in previous draft
      let bestMatch = { sentence: "", score: 0 };
      for (let pSentence of previousSentences) {
        const sim = compareTwoStrings(cSentence, pSentence);
        if (sim > bestMatch.score) {
          bestMatch = { sentence: pSentence, score: sim };
        }
      }

      if (bestMatch.score > 0.8) {
        matchedSegments.push({
          segment: cSentence,
          similarity: Math.round(bestMatch.score * 100),
          sourceParams: { start: 0, end: 0 }, // Would need real positions
          targetParams: { start: 0, end: 0 },
        });
        overlapCount++;
      }
    }

    const overlapPercentage = Math.round(
      (overlapCount / Math.max(1, currentSentences.length)) * 100
    );

    let analysis = "No significant overlap detected.";
    let isSelfPlagiarismInternal = false;

    if (score > 80 && overlapPercentage > 80) {
      analysis =
        "High overlap detected: These documents appear to be nearly identical versions.";
      isSelfPlagiarismInternal = true;
    } else if (score > 40 || overlapPercentage > 30) {
      analysis =
        "Significant reuse detected: This is likely a previous draft. Turnitin flags this, but since it matches your own work history, it is generally safe if this is an updated version of the SAME assignment.";
      isSelfPlagiarismInternal = true;
    } else if (score > 10) {
      analysis =
        "Some sections appear to be reused. Ensure you distinguish between reusing partial work and submitting the same paper twice.";
    }

    return {
      similarityScore: score,
      overlapPercentage,
      matchedSegments,
      analysis,
      isSelfPlagiarismInternal,
    };
  }
}
