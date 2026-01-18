import { prisma } from "../lib/prisma";
import logger from "../monitoring/logger";
import { compareTwoStrings } from "string-similarity";
import axios from "axios";
import crypto from "crypto";
import { EmailService } from "./emailService";
import { SubscriptionService } from "./subscriptionService";
import { UsageService } from "./usageService";
import { SecretsService } from "./secrets-service";
import { CopyleaksService } from "./copyleaksService";

// @ts-ignore
// import { pipeline, env } from "@xenova/transformers";

// Dynamic import holder
let pipeline: any;
let env: any;

async function getTransformers() {
  if (!pipeline || !env) {
    const mod = await import("@xenova/transformers");
    pipeline = mod.pipeline;
    env = mod.env;

    // Configure transformers
    env.allowLocalModels = false;
    env.useBrowserCache = false;
  }
  return { pipeline, env };
}

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
      const { pipeline } = await getTransformers();
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
          scan_status: "processing", // Continues to be processing until Copyleaks returns
        },
      });

      // Track usage
      await UsageService.trackUsage(userId, "originality_scan");

      // ---------------------------------------------------------
      // HYBRID ACTIVE DEFENSE: STEP 1 - Trigger Copyleaks (Deep Scan)
      // ---------------------------------------------------------
      try {
        // Find the 'SANDBOX' flag in secrets or env, default to true for safety
        const isProduction = process.env.NODE_ENV === 'production';
        // We use sandbox=true unless explicitly told otherwise or in prod with a strict flag
        const useSandbox = process.env.COPYLEAKS_SANDBOX !== 'false';

        await CopyleaksService.submitTextScan(scan.id, scanContent, useSandbox);
        logger.info("Deep Scan (Copyleaks) initiated", { scanId: scan.id });
      } catch (copyleaksError: any) {
        logger.error("Deep Scan initiation failed", { error: copyleaksError.message });
        // We continue! We still have Google Search as fallback
      }

      // ---------------------------------------------------------
      // HYBRID ACTIVE DEFENSE: STEP 2 - Google Search (Immediate Results)
      // ---------------------------------------------------------
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
      let weightedScoreSum = 0;
      matches.forEach((m) => {
        weightedScoreSum += (m.similarityScore / 100) * m.sentenceText.length;
      });

      // Calculate score based on the actual scanned portion (or total content if smaller)
      const effectiveLength = Math.min(scanContent.length, scanLimit);

      const overallScore =
        effectiveLength > 0
          ? Math.min(100, (weightedScoreSum / effectiveLength) * 100)
          : 0;

      const classification = this.classifyOverall(overallScore);

      // Update scan with results (from Google Search)
      // NOTE: We do NOT set status to 'completed' yet because Copyleaks is still running!
      // We save the "Quick Matches" now so the user sees something immediately.
      const updatedScan = await prisma.originalityScan.update({
        where: { id: scan.id },
        data: {
          overall_score: overallScore,
          classification,
          // scan_status: "completed", // <-- CHANGED: Keep as 'processing' for Copyleaks
        },
        include: {
          matches: true,
        },
      });

      logger.info("Scan completed (Google phase)", {
        scanId: scan.id,
        overallScore,
        matchesFound: matches.length,
        skippedQuotes,
        bibliographyExcluded: !!bibSection,
        excludedChars,
      });

      // Send completion email (this might need to be delayed until Copyleaks finishes?)
      // For now we send it here as a "Preliminary Result" or just wait.
      // Actually, let's wait for the webhook to send the FINAL email if Copyleaks is enabled.
      // But if Copyleaks fails?
      // Let's keep it here for now so the user gets *something*.

      return this.formatScanResult(updatedScan);
    } catch (error: any) {
      logger.error("Error performing scan", { error: error.message, projectId });
      throw new Error(`Failed to perform scan: ${error.message}`);
    }
  }

  /**
   * Process results from Copyleaks Webhook
   */
  static async processCopyleaksResult(scanId: string, payload: any) {
    try {
      logger.info("Processing Copyleaks results", { scanId });

      // Calculate Score (Copyleaks provides aggregated score or we calculate from matches)
      const copyleaksScore = payload.results?.score?.aggregatedScore || 0;

      let classification: "safe" | "review" | "action_required" = "safe";
      if (copyleaksScore > this.REVIEW_THRESHOLD) classification = "action_required";
      else if (copyleaksScore > this.SAFE_THRESHOLD) classification = "review";

      // Parse matches
      // Copyleaks structure: results.internet, results.database, etc.
      const sources = [
        ...(payload.results?.internet || []),
        ...(payload.results?.database || []),
        ...(payload.results?.batch || [])
      ];

      // We wipe existing "Quick Matches" (Google) to replace with "Deep Matches" (Copyleaks)
      await prisma.similarityMatch.deleteMany({
        where: { scan_id: scanId }
      });

      for (const source of sources) {
        // Only convert significant matches
        if (source.matchedWords > 10) {
          await prisma.similarityMatch.create({
            data: {
              scan_id: scanId,
              sentence_text: source.title || "Matched Segment",
              matched_source: source.title,
              source_url: source.url,
              similarity_score: (source.matchedWords / payload.scannedWords) * 100, // Approximation
              position_start: 0, // Difficult to map perfectly without parsing offsets
              position_end: 0,
              classification: "red" // Assumed flagged by Copyleaks
            }
          });
        }
      }

      // Finalize Scan
      await prisma.originalityScan.update({
        where: { id: scanId },
        data: {
          overall_score: copyleaksScore,
          classification: classification,
          scan_status: "completed",
        }
      });

      logger.info("Copyleaks processing complete", { scanId, score: copyleaksScore });

    } catch (error: any) {
      logger.error("Failed to process Copyleaks result", { error: error.message, scanId });
      await prisma.originalityScan.update({
        where: { id: scanId },
        data: { scan_status: "failed" }
      });
    }
  }

  /**
   * Calculate similarity between two text strings using Hybrid approach:
   */
  static async calculateSimilarity(
    text1: string,
    text2: string
  ): Promise<number> {
    try {
      // 1. Calculate String Similarity (Dice Coefficient)
      const normalized1 = await this.normalizeText(text1);
      const normalized2 = await this.normalizeText(text2);

      const stringScore = compareTwoStrings(normalized1, normalized2);

      if (stringScore > 0.8) {
        return stringScore;
      }

      // 2. Calculate Semantic Similarity (Cosine Similarity)
      try {
        const extractor = await TransformerService.getInstance();
        if (extractor) {
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
          return Math.max(stringScore, cosineScore);
        }
      } catch (aiError) {
        logger.warn(
          "Failed to calculate semantic similarity, falling back to string similarity",
          { error: aiError }
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

    if (normA === 0 || normB === 0) return 0;

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Normalize text for comparison
   */
  private static async normalizeText(text: string): Promise<string> {
    let normalized = text.toLowerCase();
    normalized = normalized.replace(/[^\w\s]/g, " ");
    normalized = normalized.replace(/\s+/g, " ").trim();

    const words = normalized.split(" ");
    const { removeStopwords } = await import("stopword");
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

      if (!googleApiKey || !googleSearchEngineId) {
        logger.warn(
          "Google Custom Search API not configured, skipping online search"
        );
        return [];
      }

      const query = sentence.substring(0, 100);

      const response = await axios.get(
        "https://www.googleapis.com/customsearch/v1",
        {
          params: {
            key: googleApiKey,
            cx: googleSearchEngineId,
            q: query,
            num: 3,
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

    const hasCitation = /\[\d+\]|\([A-Za-z\s.&,;]+,?\s?\d{4}(?:,?\s?p{1,2}\.?\s?[\d-]+)?\)/.test(sentence);

    if (hasQuotes) {
      return "quoted_correctly";
    }

    if (words < 12) {
      return "safe";
    }

    if (score > 70) {
      return hasCitation ? "safe" : "needs_citation";
    }

    if (score > 25) {
      return hasCitation ? "safe" : "close_paraphrase";
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
    return text.match(/[^.!?]+[.!?]+["']?|[^.!?]+$/g)
      ?.map(s => s.trim())
      .filter(s => s.length > 0) || [];
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

    const badMatches = matches.filter(
      (m) =>
        m.classification === "needs_citation" ||
        m.classification === "close_paraphrase"
    ).length;

    // 1. Base Score from Matches
    let baseTrustScore = Math.max(0, 100 - (badMatches / Math.max(1, totalMatches)) * 100);

    // 2. Linguistic Analysis (Heuristic via content analysis if available, otherwise implied)
    // Since we don't have raw content here in this method signature, we rely on match patterns.
    // If 'referencePercent' is high (>30%) but 'badMatches' is low, it implies "Academic Rigor".
    // If 'commonPhrasePercent' is high (>20%), it implies "Natural Language" (Humans use idioms).

    let linguisticBonus = 0;
    if (referencePercent > 15) linguisticBonus += 5; // Good referencing habit
    if (commonPhrasePercent > 10 && commonPhrasePercent < 40) linguisticBonus += 5; // Natural idiomatic usage

    // Penalize if 0 references found in a rigorous scan (suspicious for academic work)
    if (referencePercent === 0 && overallScore > 0) baseTrustScore -= 5;

    let finalTrustScore = Math.min(100, baseTrustScore + linguisticBonus);

    // 3. Construct Analysis Message
    let message = "Originality looks good.";
    if (finalTrustScore > 80) {
      if (referencePercent > 20) message = "Excellent academic integrity detected (References + Originality).";
      else message = "High originality score. Verify citations are present if required.";
    } else if (finalTrustScore > 50) {
      if (badMatches > 5) message = "Several sections need citation or rephrasing.";
      else message = "Moderate similarity found. Ensure quotes are properly attributed.";
    } else {
      message = "Significant similarity detected. Review flagged sections carefully.";
    }

    return {
      referencePercent,
      commonPhrasePercent,
      trustScore: Math.round(finalTrustScore),
      message,
    };
  }

  /**
   * Analyze text for "AI-ness" vs "Human-ness" features (Burstiness & Entropy proxy)
   * This can be used to augment the Reality Check if content is available.
   */
  static analyzeLinguisticFeatures(text: string): { burstiness: number; isLikelyHuman: boolean } {
    if (!text || text.length < 100) return { burstiness: 0, isLikelyHuman: true };

    const sentences = text.match(/[^\.!\?]+[\.!\?]+/g) || [];
    if (sentences.length < 5) return { burstiness: 0, isLikelyHuman: true };

    // Calculate Sentence Lengths
    const lengths = sentences.map(s => s.trim().split(/\s+/).length);

    // Calculate Variance (Standard Deviation)
    const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const variance = lengths.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / lengths.length;
    const stdDev = Math.sqrt(variance);

    // "Burstiness" Score (CV - Coefficient of Variation)
    // AI tends to be more uniform (lower CV). Humans are erratic (higher CV).
    // Typical AI ~ 0.2 - 0.4?? Actually, AI is getting better.
    // But high variance is a STRONG human signal.
    const burstiness = stdDev / mean;

    // Thresholds (Heuristic)
    // Low burstiness (< 0.4) -> Robotic/Monotone
    // High burstiness (> 0.5) -> Human
    const isLikelyHuman = burstiness > 0.45;

    return { burstiness, isLikelyHuman };
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

    const currentSentences = this.splitIntoSentences(currentDraft);
    const previousSentences = this.splitIntoSentences(previousDraft);

    const matchedSegments = [];
    let overlapCount = 0;

    for (let cSentence of currentSentences) {
      if (cSentence.length < 20) continue;

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
          sourceParams: { start: 0, end: 0 },
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
