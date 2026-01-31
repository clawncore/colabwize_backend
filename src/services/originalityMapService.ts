import { prisma } from "../lib/prisma";
import { CopyscapeService, PlagiarismMatch } from "./copyscapeService";
import { SecretsService } from "./secrets-service";
import logger from "../monitoring/logger";
import * as crypto from "crypto";

export class OriginalityMapService {

  /**
   * Start a Copyscape-ONLY Scan
   * Strict textual plagiarism detection. No AI. No Semantics.
   */
  static async startScan(projectId: string, userId: string, content: string) {
    logger.info("Starting Copyscape-only plagiarism scan", { projectId, userId });

    // 1. Check Cache
    const contentHash = crypto.createHash('md5').update(content).digest('hex');
    const existingScan = await prisma.originalityScan.findFirst({
      where: {
        content_hash: contentHash,
        user_id: userId,
        scan_status: "completed"
      },
      include: { matches: true }
    });

    if (existingScan) {
      // Return cached result if it's successfully completed
      logger.info("Found cached scan result", { scanId: existingScan.id });
      return existingScan;
    }

    // 2. Create DB Record (Processing)
    const scan = await prisma.originalityScan.create({
      data: {
        project_id: projectId,
        user_id: userId,
        content_hash: contentHash,
        overall_score: 0,
        classification: "safe", // Default until proven guilty
        scan_status: "processing"
      }
    });

    try {
      // 3. Call Copyscape (Source of Truth)
      // New return signature: { matches, summary }
      const { matches, summary } = await CopyscapeService.scanText(content);

      let maxSimilarity = 0;

      if (matches.length > 0) {
        // Insert matches
        for (const match of matches) {
          // strict mapping: 
          // >70% -> Red
          // 40-70% -> Yellow (Amber)
          // <40% -> Green (Safe/Minor)
          let classification: "red" | "yellow" | "green" = "green";
          if (match.similarity >= 40) classification = "yellow";
          if (match.similarity >= 70) classification = "red";

          // Track max score locally for match-level logic
          if (match.similarity > maxSimilarity) maxSimilarity = match.similarity;

          await prisma.similarityMatch.create({
            data: {
              scan_id: scan.id,
              sentence_text: content.substring(match.start, match.end),
              matched_source: match.sourceUrl,
              source_url: match.sourceUrl,
              view_url: match.viewUrl || null,
              matched_words: Math.floor(Number(match.matchedWords || 0)),
              source_words: Math.floor(Number(match.sourceWords || 0)),
              match_percent: Number(match.matchPercent || 0),
              similarity_score: Number(match.similarity || 0),
              position_start: Math.floor(Number(match.start)),
              position_end: Math.floor(Number(match.end)),
              classification: classification,
            }
          });
        }
      }

      // 4. Update Final Status
      // Use Copyscape's official "All Percent Matched" as the Overall Score
      const finalScore = summary.allPercentMatched || maxSimilarity; // Fallback only if 0
      const status = finalScore > 10 ? "action_required" : "safe"; // >10% is usually significant

      await prisma.originalityScan.update({
        where: { id: scan.id },
        data: {
          overall_score: Number(finalScore),
          classification: status,
          scan_status: "completed",
          words_scanned: Math.floor(Number(summary.queryWords || 0)),
          cost_amount: Number(summary.cost || 0),
          match_count: Math.floor(Number(summary.count || 0))
        }
      });

      // Return full fresh result
      return this.getScanResults(scan.id, userId);

    } catch (e: any) {
      logger.error("Copyscape Scan Failed", { error: e.message });

      // Mark as failed regardless of reason so UI shows "Error" state (Dashes)
      await prisma.originalityScan.update({
        where: { id: scan.id },
        data: {
          scan_status: "failed",
          classification: "action_required", // blocked
          overall_score: -1, // -1 indicates error/null
          match_count: 0
        }
      });

      // Return the failed result so UI can display it
      const result = await this.getScanResults(scan.id, userId);

      // Check if it was a System Credit/Maintenance error
      if (e.message && (e.message.includes("Insufficient credit") || e.message.includes("credits"))) {
        return { ...result, failureCode: "SYSTEM_CREDITS", failureMessage: e.message };
      }

      return { ...result, failureMessage: e.message };
    }
  }

  /**
   * Alias for startScan to support API expectations
   */
  static async scanDocument(projectId: string, userId: string, content: string, plan: string = "free") {
    return this.startScan(projectId, userId, content);
  }

  /**
   * Get results for a specific scan
   */
  static async getScanResults(scanId: string, userId: string) {
    const scan = await prisma.originalityScan.findFirst({
      where: {
        id: scanId,
        user_id: userId
      },
      include: {
        matches: true
      }
    });

    if (!scan) {
      throw new Error("Scan not found or access denied");
    }

    // Map snake_case to camelCase for frontend
    return {
      id: scan.id,
      projectId: scan.project_id,
      userId: scan.user_id,
      overallScore: scan.overall_score,
      classification: scan.classification,
      scanStatus: scan.scan_status,
      scannedAt: scan.scanned_at,
      wordsScanned: scan.words_scanned,
      costAmount: scan.cost_amount,
      matchCount: scan.match_count,
      matches: scan.matches?.map((m: any) => ({
        id: m.id,
        scanId: m.scan_id,
        sentenceText: m.sentence_text,
        matchedSource: m.matched_source,
        sourceUrl: m.source_url,
        viewUrl: m.view_url,
        matchedWords: m.matched_words,
        sourceWords: m.source_words,
        matchPercent: m.match_percent,
        similarityScore: m.similarity_score,
        positionStart: m.position_start,
        positionEnd: m.position_end,
        classification: m.classification,
      })) || []
    };
  }

  /**
   * Get all scans for a project
   */
  static async getProjectScans(projectId: string, userId: string) {
    const scans = await prisma.originalityScan.findMany({
      where: {
        project_id: projectId,
        user_id: userId
      },
      orderBy: {
        created_at: "desc"
      },
      include: {
        matches: true
      }
    });

    return scans.map((scan: any) => ({
      id: scan.id,
      projectId: scan.project_id,
      userId: scan.user_id,
      overallScore: scan.overall_score,
      classification: scan.classification,
      scanStatus: scan.scan_status,
      scannedAt: scan.scanned_at,
      wordsScanned: scan.words_scanned,
      costAmount: scan.cost_amount,
      matchCount: scan.match_count,
      matches: scan.matches?.map((m: any) => ({
        id: m.id,
        scanId: m.scan_id,
        sentenceText: m.sentence_text,
        matchedSource: m.matched_source,
        sourceUrl: m.source_url,
        viewUrl: m.view_url,
        matchedWords: m.matched_words,
        sourceWords: m.source_words,
        matchPercent: m.match_percent,
        similarityScore: m.similarity_score,
        positionStart: m.position_start,
        positionEnd: m.position_end,
        classification: m.classification,
      })) || []
    }));
  }

  /**
   * Process Async Result from Webhook
   */
  static async processCopyleaksResult(scanId: string, payload: any) {
    // No-op
  }

  /**
   * Helper for similarity calculation
   */
  static async calculateSimilarity(text1: string, text2: string): Promise<number> {
    // Simple fallback since we disabled Enhanced service
    // Or we can import just string-similarity lib directly
    // Assuming backend has 'string-similarity' installed as it was in EnhancedService
    const { compareTwoStrings } = await import("string-similarity");
    return compareTwoStrings(text1 || "", text2 || "");
  }

  /**
   * Real-Time Section Check (Lightweight)
   * Uses Copyscape? No, expensive.
   * Uses simple string matching against DB? 
   * Active Defense usually needs *some* logic.
   * For "Strict Textual Only", we will disable the semantic check here too.
   */
  static async checkSectionRisk(projectId: string, userId: string, content: string): Promise<{
    riskScore: number;
    flags: string[];
    isAiSuspected: boolean;
  }> {
    // We can't afford Copyscape on every keystroke/section check.
    // Return neutral safe response or do a cheap internal check.
    // Let's just return 0 to be safe and avoid "Simulated/Fake" results.
    return {
      riskScore: 0,
      flags: [],
      isAiSuspected: false
    };
  }
}
