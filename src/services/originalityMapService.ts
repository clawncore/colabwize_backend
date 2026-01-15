import { prisma } from "../lib/prisma";
import logger from "../monitoring/logger";
import { compareTwoStrings } from "string-similarity";
import { removeStopwords } from "stopword";
import axios from "axios";
import crypto from "crypto";
import { EmailService } from "./emailService";
import { SubscriptionService } from "./subscriptionService";
import { UsageService } from "./usageService";
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

class TransformerService {
  private static instance: any = null;

  static async getInstance() {
    if (!this.instance) {
      logger.info("Loading feature-extraction model...");
      this.instance = await pipeline(
        "feature-extraction",
        "Xenova/all-MiniLM-L6-v2"
      );
      logger.info("Model loaded successfully");
    }
    return this.instance;
  }

  /**
   * Get user's recent projects (excluding current project)
   */
  static async getRecentProjects(userId: string, currentProjectId: string) {
    try {
      // Get user's projects created in the last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const projects = await prisma.project.findMany({
        where: {
          user_id: userId,
          id: { not: currentProjectId }, // Exclude current project
          created_at: {
            gte: thirtyDaysAgo,
          },
        },
        select: {
          id: true,
          title: true,
          content: true,
          created_at: true,
        },
        orderBy: {
          created_at: "desc",
        },
        take: 10, // Get last 10 projects
      });

      return projects;
    } catch (error: any) {
      logger.error("Error getting recent projects", { error: error.message });
      throw new Error(`Failed to get recent projects: ${error.message}`);
    }
  }
}

export class OriginalityMapService {
  // Classification thresholds (per blueprint)
  private static readonly SAFE_THRESHOLD = 24; // 0-24% = Green
  private static readonly REVIEW_THRESHOLD = 49; // 25-49% = Yellow
  // 50%+ = Red (action required)

  /**
   * Detect bibliography section for exclusion (Turnitin-style)
   */
  private static detectBibliographySection(
    content: string
  ): { start: number; end: number } | null {
    const patterns = [
      /^references$/im,
      /^bibliography$/im,
      /^works cited$/im,
      /^literature cited$/im,
      /^reference list$/im,
    ];

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match && match.index) {
        return {
          start: match.index,
          end: content.length, // Bibliography usually at end
        };
      }
    }

    return null;
  }

  /**
   * Check if sentence is properly quoted (should be excluded from plagiarism check)
   */
  private static isProperlyQuoted(sentence: string): boolean {
    const quotePatterns = [
      /^["'].*["']$/, // Full quote
      /according to .* \(\d{4}\)[,:]? ["']/i, // According to Author (2020): "quote"
      /as .* (?:stated|noted|argued|found|observed|claimed)[,:]? ["']/i, // As X stated: "quote"
      /.* \(\d{4}\) (?:states|notes|argues|finds|observes|claims)[,:]? ["']/i, // Author (2020) states: "quote"
    ];

    return quotePatterns.some((pattern) => pattern.test(sentence.trim()));
  }

  /**
   * Check if sentence contains common academic phrases
   */
  private static isCommonAcademicPhrase(sentence: string): boolean {
    const commonPhrases = [
      "in conclusion",
      "this study examines",
      "the purpose of this paper",
      "the purpose of this study",
      "furthermore",
      "on the other hand",
      "however",
      "in addition",
      "according to the literature",
      "previous research has shown",
      "this research aims to",
      "the findings suggest",
      "the results indicate",
      "it can be concluded that",
    ];

    const lowerSentence = sentence.toLowerCase();
    return commonPhrases.some((phrase) => lowerSentence.includes(phrase));
  }

  /**
   * Main scan function - scans document for originality
   */
  static async scanDocument(
    projectId: string,
    userId: string,
    content: string,
    plan: string = "free"
  ): Promise<OriginalityScanResult> {
    try {
      logger.info("Starting originality scan", { projectId, userId });

      // Check usage limits
      const usageCheck = await UsageService.checkUsageLimit(
        userId,
        "originality_scan"
      );

      if (!usageCheck.allowed) {
        throw new Error(
          `Usage limit reached for Originality Scans. Limit: ${usageCheck.limit}`
        );
      }

      // PRIORITY 1 FIX: Exclude bibliography section (like Turnitin)
      const bibSection = this.detectBibliographySection(content);
      let scanContent = content;
      let excludedChars = 0;

      if (bibSection) {
        scanContent = content.substring(0, bibSection.start);
        excludedChars = content.length - bibSection.start;
        logger.info("Bibliography section excluded", {
          excludedCharacters: excludedChars,
          percentExcluded: Math.round((excludedChars / content.length) * 100),
        });
      }

      // Generate content hash for caching
      const contentHash = this.generateContentHash(scanContent);

      // Get plan limits to ensure we respect subscription tiers
      const limits = SubscriptionService.getPlanLimits(plan);
      const scanLimit = limits.max_scan_characters || 100000;

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

      // Track usage
      await UsageService.trackUsage(userId, "originality_scan");

      // Split content into sentences (using cleaned content without bibliography)
      const sentences = this.splitIntoSentences(scanContent);
      logger.info(`Processing ${sentences.length} sentences`);

      // Initialize transformer model
      await TransformerService.getInstance();

      // Process each sentence
      const matches: SimilarityMatchResult[] = [];
      let totalSimilarity = 0;
      let position = 0;
      let skippedQuotes = 0;

      for (const sentence of sentences) {
        // Enforce Plan Limit: Stop scanning if we exceed the max characters for the user's plan
        // This prevents "overworking" the system and ensures distinct tier matching
        if (position > scanLimit) {
          break;
        }
        // REMOVED LIMITATION: Full document scan for all users as requested

        // Skip very short sentences
        if (sentence.trim().length < 20) {
          position += sentence.length;
          continue;
        }

        // PRIORITY 1 FIX: Skip properly quoted material (like Turnitin)
        if (this.isProperlyQuoted(sentence)) {
          // Find true position in content to update position tracker accurately
          const trueIndex = scanContent.indexOf(sentence, position);
          if (trueIndex !== -1) {
            position = trueIndex + sentence.length;
          } else {
            position += sentence.length;
          }
          skippedQuotes++;
          continue;
        }

        // PRIORITY 2 FIX: Skip common academic phrases to avoid false positives
        if (this.isCommonAcademicPhrase(sentence)) {
          const trueIndex = scanContent.indexOf(sentence, position);
          if (trueIndex !== -1) {
            position = trueIndex + sentence.length;
          } else {
            position += sentence.length;
          }
          continue;
        }

        // Search online for similar content
        const onlineMatches = await this.searchOnline(sentence);

        // Find precise position match in the original content
        // We look ahead from the current position
        const trueStartIndex = scanContent.indexOf(sentence, position);
        let actualStart = position;
        let actualEnd = position + sentence.length;

        if (trueStartIndex !== -1) {
          actualStart = trueStartIndex;
          actualEnd = trueStartIndex + sentence.length;
          // Update position pointer to the end of this sentence
          position = actualEnd;
        } else {
          // Fallback if exact string match fails (unlikely unless encoding differs)
          position += sentence.length;
        }

        if (onlineMatches.length > 0) {
          // Calculate similarity with best match
          const bestMatch = onlineMatches[0];
          const similarity = await this.calculateSimilarity(
            sentence,
            bestMatch.snippet
          );
          const similarityPercentage = similarity * 100;

          // Only store if similarity is significant (>20%)
          if (similarityPercentage > 20) {
            const classification = this.classifyMatch(
              similarityPercentage,
              sentence
            );

            const match = await prisma.similarityMatch.create({
              data: {
                scan_id: scan.id,
                sentence_text: sentence,
                matched_source: bestMatch.snippet,
                source_url: bestMatch.link,
                similarity_score: similarityPercentage,
                position_start: actualStart,
                position_end: actualEnd,
                classification,
              },
            });

            matches.push({
              id: match.id,
              sentenceText: match.sentence_text,
              matchedSource: match.matched_source,
              sourceUrl: match.source_url || undefined,
              similarityScore: match.similarity_score,
              positionStart: match.position_start,
              positionEnd: match.position_end,
              classification: classification as "green" | "yellow" | "red",
            });

            totalSimilarity += similarityPercentage;
          }
        }

        // Rate limiting - wait 100ms between searches to avoid hitting API limits
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Calculate overall score (Weighted by character length)
      // Previous logic was just average of matches, which gave falsely high scores (e.g. 1 match = 100%)
      // New logic: (Sum of (Similarity * SentenceLength)) / TotalDocLength
      let weightedScoreSum = 0;
      matches.forEach((m) => {
        weightedScoreSum += (m.similarityScore / 100) * m.sentenceText.length;
      });

      // Calculate score based on the actual scanned portion (or total content if smaller)
      // This ensures fair scoring even if we hit a limit
      const effectiveLength = Math.min(scanContent.length, scanLimit);

      const overallScore =
        effectiveLength > 0
          ? Math.min(100, (weightedScoreSum / effectiveLength) * 100)
          : 0;

      const classification = this.classifyOverall(overallScore);

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

      logger.info("Scan completed", {
        scanId: scan.id,
        overallScore,
        matchesFound: matches.length,
        skippedQuotes,
        bibliographyExcluded: !!bibSection,
        excludedChars,
      });

      // Send completion email
      try {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        // Assuming project is available or we can fetch it. If project_id refers to a document, we might need to adjust.
        // But the argument is projectId, so let's check if project table exists.
        // Using safe approach:
        const project = await prisma.project.findUnique({
          where: { id: projectId },
        });

        if (user && user.email && project) {
          await EmailService.sendScanCompletionEmail(
            user.email,
            user.full_name || "ColabWize User",
            "originality",
            project.title || "Untitled Project",
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

      return this.formatScanResult(updatedScan);
    } catch (error: any) {
      logger.error("Error scanning document", {
        error: error.message,
        projectId,
        userId,
      });
      throw new Error(`Failed to scan document: ${error.message}`);
    }
  }

  /**
   * Calculate similarity between two text strings using Hybrid approach:
   * 1. Dice Coefficient (string-similarity) for exact match / ordering
   * 2. Cosine Similarity (sentence-transformers) for semantic match
   */
  static async calculateSimilarity(
    text1: string,
    text2: string
  ): Promise<number> {
    try {
      // 1. Calculate String Similarity (Dice Coefficient)
      // Normalize texts
      const normalized1 = this.normalizeText(text1);
      const normalized2 = this.normalizeText(text2);

      const stringScore = compareTwoStrings(normalized1, normalized2);

      // If string similarity is very high, it's likely a direct copy or slightly modified copy.
      // We can return early to save compute.
      if (stringScore > 0.8) {
        return stringScore;
      }

      // 2. Calculate Semantic Similarity (Cosine Similarity)
      try {
        const extractor = await TransformerService.getInstance();
        if (extractor) {
          // Generate embeddings
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

          const cosineScore = this.cosineSimilarity(embedding1, embedding2);

          // Return the maximum of the two scores
          // This ensures we catch both "exact copies" and "clever paraphrases"
          return Math.max(stringScore, cosineScore);
        }
      } catch (aiError) {
        logger.warn(
          "Failed to calculate semantic similarity, falling back to string similarity",
          {
            error: aiError,
          }
        );
      }

      return stringScore;
    } catch (error: any) {
      logger.error("Error calculating similarity", { error: error.message });
      return 0;
    }
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
   * Classify match based on similarity, length, and content analysis
   */
  private static classifyMatch(score: number, sentence: string): string {
    const words = sentence.trim().split(/\s+/).length;
    const hasQuotes =
      /^['"“].*['"”]$/.test(sentence.trim()) ||
      (sentence.includes('"') && sentence.split('"').length > 2);

    // Check for common citation patterns: (Name, Year), [1], ^{1}
    const hasCitation = /\([A-Za-z\s]+,?\s?\d{4}\)|\[\d+\]/.test(sentence);

    if (hasQuotes) {
      return "quoted_correctly";
    }

    if (words < 8) {
      return "common_phrase";
    }

    if (score > 60) {
      return hasCitation ? "safe" : "needs_citation";
    }

    if (score > 24) {
      return "close_paraphrase";
    }

    return "safe";
  }

  /**
   * Classify overall scan result
   */
  private static classifyOverall(
    score: number
  ): "safe" | "review" | "action_required" {
    if (score <= this.SAFE_THRESHOLD) {
      return "safe";
    } else if (score <= this.REVIEW_THRESHOLD) {
      return "review";
    } else {
      return "action_required";
    }
  }

  /**
   * Split text into sentences
   */
  private static splitIntoSentences(text: string): string[] {
    // Enhanced sentence splitting:
    // 1. Split by common sentence terminators (. ! ?)
    // 2. Split by newlines (for headers/lists)
    // 3. Keep delimiters check if needed, but for now simple split is safer for "giant blob" prevention
    return text
      .split(/([.!?]+|\n+)/) // Split by punctuation OR newlines, keeping delimiters to map back if needed (though map below flattens)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !/^[.!?]+$/.test(s)); // Filter out empty strings and standalone punctuation
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
            similarityScore: match.similarity_score,
            positionStart: match.position_start,
            positionEnd: match.position_end,
            classification: match.classification as any,
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
