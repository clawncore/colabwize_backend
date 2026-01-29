import { prisma } from "../lib/prisma";
import logger from "../monitoring/logger";
import { OpenAIService } from "./openaiService";
import { compareTwoStrings } from "string-similarity";
import { AbuseGuard, RephraseMode } from "./AbuseGuard";

import { UsageService } from "./usageService";

export interface RephraseResult {
  id: string;
  originalText: string;
  suggestedText: string;
}

export class RephraseService {
  /**
   * Generate rephrase suggestions for flagged text
   */
  static async generateRephraseSuggestions(
    scanId: string,
    matchId: string,
    originalText: string,
    userId: string,
    mode: RephraseMode = RephraseMode.ACADEMIC
  ): Promise<RephraseResult[]> {
    try {
      logger.info("Generating rephrase suggestions", { scanId, matchId, mode });

      // 1. Abuse & Similarity Guard
      const abuseCheck = await AbuseGuard.checkAbuse(userId, originalText);

      // Degrade mode if abuse detected
      let effectiveMode = mode;
      if (abuseCheck.isAbuse) {
        if (abuseCheck.degradeTo === "CACHED") {
          logger.warn(`Abuse limit hit: Forcing CACHED response for user ${userId}`);
          return await this.getCachedOrFallback(scanId, originalText);
        }
        if (abuseCheck.degradeTo === "LOCAL") {
          logger.warn(`Abuse limit hit: Forcing LOCAL response for user ${userId}`);
          effectiveMode = RephraseMode.QUICK; // Limit cost/usage
        }
      }

      // 2. Character-Based Accounting (Internal Tracking)
      // We calculate "units" consumed but don't hard-block Pro users.
      // 1 Unit = 500 chars * Mode Multiplier
      const unitsConsumed = AbuseGuard.calculateCost(originalText, effectiveMode);

      // Track usage asynchronously (fire and forget)
      // We assume UsageService handles per-user limits internally if needed, 
      // but here we just want to record the "volume" of work.
      // We pass 'rephrase_chars' as the feature to track raw volume, or 'rephrase_units'
      UsageService.trackUsage(userId, 'rephrase_requests').catch((e: any) => logger.error("Failed to track usage", e));
      // Ideally we'd track units, but existing trackUsage increments by 1. 
      // For now, tracking requests is fine for velocity, detailed billing might need a schema update.

      // Check if this is a temporary/ad-hoc request
      const isTemporary = scanId.startsWith("temp-");

      if (!isTemporary) {
        // Verify scan belongs to user
        const scan = await prisma.originalityScan.findFirst({
          where: {
            id: scanId,
            user_id: userId,
          },
        });

        if (!scan) throw new Error("Scan not found or access denied");

        // Check cache (unless DEEP mode requested explicitly, though even then we might cache)
        if (effectiveMode !== RephraseMode.DEEP) {
          const existingSuggestions = await prisma.rephraseSuggestion.findMany({
            where: {
              scan_id: scanId,
              original_text: originalText,
            },
          });

          if (existingSuggestions.length > 0) {
            logger.info("Found cached rephrase suggestions");
            return existingSuggestions.map((s: any) => ({
              id: s.id,
              originalText: s.original_text,
              suggestedText: s.suggested_text,
            }));
          }
        }
      }

      // Generate new suggestions using AI (or Local if degraded)
      const suggestions = await this.generateAIRephrases(originalText, effectiveMode);

      // Store suggestions in database ONLY if not temporary
      const savedSuggestions: RephraseResult[] = [];

      if (!isTemporary) {
        for (const suggestion of suggestions) {
          const saved = await prisma.rephraseSuggestion.create({
            data: {
              scan_id: scanId,
              match_id: matchId,
              original_text: originalText,
              suggested_text: suggestion,
            },
          });

          savedSuggestions.push({
            id: saved.id,
            originalText: saved.original_text,
            suggestedText: saved.suggested_text,
          });
        }
      } else {
        // For temporary requests
        return suggestions.map((suggestion, index) => ({
          id: `temp-sugg-${Date.now()}-${index}`,
          originalText: originalText,
          suggestedText: suggestion,
        }));
      }

      logger.info(`Generated ${savedSuggestions.length} rephrase suggestions`);

      return savedSuggestions;
    } catch (error: any) {
      logger.error("Error generating rephrase suggestions", {
        error: error.message,
        scanId,
      });
      // Fallback to local on crash
      const fallback = this.generateLocalRephrases(originalText);
      return fallback.map((suggestion, index) => ({
        id: `fallback-${Date.now()}-${index}`,
        originalText: originalText,
        suggestedText: suggestion,
      }));
    }
  }

  /**
   * Helper to return cached or fallback result
   */
  private static async getCachedOrFallback(scanId: string, originalText: string): Promise<RephraseResult[]> {
    // Try DB Cache
    const existingSuggestions = await prisma.rephraseSuggestion.findMany({
      where: { scan_id: scanId, original_text: originalText },
      take: 3
    });

    if (existingSuggestions.length > 0) {
      return existingSuggestions.map((s: any) => ({
        id: s.id,
        originalText: s.original_text,
        suggestedText: s.suggested_text,
      }));
    }

    // Fallback to Local
    const local = this.generateLocalRephrases(originalText);
    return local.map((suggestion, index) => ({
      id: `abused-fallback-${Date.now()}-${index}`,
      originalText: originalText,
      suggestedText: suggestion,
    }));
  }

  /**
   * Generate AI-powered rephrase suggestions with Mode support
   */
  private static async generateAIRephrases(
    originalText: string,
    mode: RephraseMode
  ): Promise<string[]> {
    try {
      // 1. QUICK / LOCAL Mode
      if (mode === RephraseMode.QUICK) {
        return this.generateLocalRephrases(originalText);
      }

      // 2. ACADEMIC / DEEP Mode
      // First, establish local baseline
      const localSuggestions = this.generateLocalRephrases(originalText);

      const prompt = mode === RephraseMode.DEEP
        ? `Critically analyze and rewrite the following text to substantially improve its academic rigor, clarity, and flow. Use sophisticated vocabulary and varied sentence structure. Return 3 distinct versions numbered 1-3:\n\nOriginal: "${originalText}"\n\nVersions:`
        : `Rewrite the following text to improve clarity and academic tone. Return 3 numbered versions:\n\nOriginal: "${originalText}"\n\nVersions:`;

      const response = await OpenAIService.generateCompletion(prompt, {
        maxTokens: mode === RephraseMode.DEEP ? 500 : 300,
        temperature: mode === RephraseMode.DEEP ? 0.8 : 0.7,
        model: mode === RephraseMode.DEEP ? "gpt-4" : "gpt-3.5-turbo" // Hypothetical model switch
      });

      const aiSuggestions = this.parseSuggestions(response);

      // Combine: 1 Local + AI suggestions
      // We prioritize AI in Deep/Academic modes but keep one local as a "conservative" option if possible
      const combined = [...localSuggestions.slice(0, 1), ...aiSuggestions];

      return combined.slice(0, 5); // Return max 5

    } catch (error: any) {
      logger.error("Error generating AI rephrases", { error: error.message });
      // Fallback
      return this.generateLocalRephrases(originalText);
    }
  }

  /**
   * Generate rephrase suggestions using local linguistic transformations
   */
  private static generateLocalRephrases(originalText: string): string[] {
    const suggestions: string[] = [];

    // Method 1: Synonym replacement
    const synonymSuggestion = this.replaceSynonyms(originalText);
    if (synonymSuggestion !== originalText) {
      suggestions.push(synonymSuggestion);
    }

    // Method 2: Sentence restructuring
    const restructuredSuggestion = this.restructureSentence(originalText);
    if (
      restructuredSuggestion !== originalText &&
      !this.isTooSimilar(suggestions, restructuredSuggestion)
    ) {
      suggestions.push(restructuredSuggestion);
    }

    // Method 3: Voice transformation (active/passive)
    const voiceTransformedSuggestion = this.transformVoice(originalText);
    if (
      voiceTransformedSuggestion !== originalText &&
      !this.isTooSimilar(suggestions, voiceTransformedSuggestion)
    ) {
      suggestions.push(voiceTransformedSuggestion);
    }

    // Method 4: Paraphrasing using phrase substitution
    const paraphrasedSuggestion = this.paraphrasePhrases(originalText);
    if (
      paraphrasedSuggestion !== originalText &&
      !this.isTooSimilar(suggestions, paraphrasedSuggestion)
    ) {
      suggestions.push(paraphrasedSuggestion);
    }

    // Method 5: Academic tone adjustment
    const academicSuggestion = this.adjustAcademicTone(originalText);
    if (
      academicSuggestion !== originalText &&
      !this.isTooSimilar(suggestions, academicSuggestion)
    ) {
      suggestions.push(academicSuggestion);
    }

    // Ensure we have at least ONE backup if all else fails (identity implies failure, but we want to return SOMETHING)
    if (suggestions.length === 0) {
      suggestions.push("Consider revising this sentence for clarity.");
    }

    return suggestions.slice(0, 5); // Return max 5 suggestions
  }

  /**
   * Check if a new suggestion is too similar to existing ones
   */
  private static isTooSimilar(
    suggestions: string[],
    newSuggestion: string
  ): boolean {
    for (const suggestion of suggestions) {
      const similarity = compareTwoStrings(suggestion, newSuggestion);
      if (similarity > 0.8) {
        return true;
      }
    }
    return false;
  }

  /**
   * Replace words with synonyms
   */
  private static replaceSynonyms(text: string): string {
    const synonyms: Record<string, string[]> = {
      important: ["significant", "crucial", "vital", "essential", "key"],
      analyze: ["examine", "investigate", "study", "evaluate", "assess"],
      demonstrate: ["show", "illustrate", "prove", "exhibit", "reveal"],
      significant: ["substantial", "considerable", "notable", "meaningful"],
      research: ["study", "investigation", "enquiry", "exploration"],
      therefore: ["thus", "consequently", "accordingly", "hence"],
      however: ["nevertheless", "nonetheless", "yet", "although"],
      moreover: ["furthermore", "additionally", "besides"],
      conclude: ["deduce", "infer", "determine", "summarize"],
    };

    let result = text;
    Object.entries(synonyms).forEach(([word, replacements]) => {
      const regex = new RegExp("\\b" + word + "\\b", "gi");
      result = result.replace(regex, replacements[0]);
    });
    return result;
  }

  /**
   * Restructure sentences
   */
  private static restructureSentence(text: string): string {
    let result = text.replace(/(\w+) because (\w+)/gi, "$2, therefore $1");
    result = result.replace(/(\w+), therefore (\w+)/gi, "$2 because $1");
    return result;
  }

  /**
   * Transform voice
   */
  private static transformVoice(text: string): string {
    let result = text.replace(/(\w+) studies/gi, "studies are conducted by $1");
    result = result.replace(/(\w+) analyzes/gi, "analyses are performed by $1");
    result = result.replace(/(\w+) demonstrates/gi, "it is demonstrated by $1");
    return result;
  }

  /**
   * Paraphrase phrases
   */
  private static paraphrasePhrases(text: string): string {
    const phraseReplacements: Record<string, string> = {
      "in conclusion": "to conclude",
      "on the other hand": "alternatively",
      "as a result": "consequently",
      "due to": "owing to",
      "in addition": "furthermore",
      "for example": "for instance",
      "according to": "as stated by",
      "in other words": "that is to say",
    };
    let result = text;
    Object.entries(phraseReplacements).forEach(([phrase, replacement]) => {
      const regex = new RegExp(phrase, "gi");
      result = result.replace(regex, replacement);
    });
    return result;
  }

  /**
   * Adjust academic tone
   */
  private static adjustAcademicTone(text: string): string {
    let result = text.replace(/\bi\b/g, "one");
    result = result.replace(/\byou\b/g, "one");
    result = result.replace(/\bwe\b/g, "researchers");
    result = result.replace(/\bthink\b/g, "consider");
    result = result.replace(/\bsay\b/g, "suggest");
    result = result.replace(/\bseems\b/g, "appears");
    return result;
  }

  /**
   * Parse AI response
   */
  private static parseSuggestions(response: string): string[] {
    const lines = response.split(/\n/).map((line) => line.trim()).filter((line) => line.length > 0);
    const suggestions: string[] = [];
    for (const line of lines) {
      const cleaned = line.replace(/^\d+[\.\)]\s*/, "").trim();
      if (cleaned.length > 10) suggestions.push(cleaned);
    }
    return suggestions;
  }

  /**
   * Get all rephrase suggestions for a scan
   */
  static async getScanSuggestions(
    scanId: string,
    userId: string
  ): Promise<RephraseResult[]> {
    try {
      // Verify scan belongs to user
      const scan = await prisma.originalityScan.findFirst({
        where: {
          id: scanId,
          user_id: userId,
        },
      });

      if (!scan) {
        throw new Error("Scan not found or access denied");
      }

      const suggestions = await prisma.rephraseSuggestion.findMany({
        where: {
          scan_id: scanId,
        },
        orderBy: {
          created_at: "desc",
        },
      });

      return suggestions.map((s: any) => ({
        id: s.id,
        originalText: s.original_text,
        suggestedText: s.suggested_text,
      }));
    } catch (error: any) {
      logger.error("Error getting scan suggestions", {
        error: error.message,
        scanId,
      });
      throw new Error(`Failed to get scan suggestions: ${error.message}`);
    }
  }
}
