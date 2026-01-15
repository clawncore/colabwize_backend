import { prisma } from "../lib/prisma";
import logger from "../monitoring/logger";
import { OpenAIService } from "./openaiService";
import { compareTwoStrings } from "string-similarity";

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
    userId: string
  ): Promise<RephraseResult[]> {
    try {
      logger.info("Generating rephrase suggestions", { scanId, matchId });

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

        if (!scan) {
          throw new Error("Scan not found or access denied");
        }

        // Check if we already have suggestions for this text (caching)
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

      // Generate new suggestions using AI
      const suggestions = await this.generateAIRephrases(originalText);

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
        // For temporary requests, just return the generated suggestions with fake IDs
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
      throw new Error(
        `Failed to generate rephrase suggestions: ${error.message}`
      );
    }
  }

  /**
   * Generate AI-powered rephrase suggestions
   */
  private static async generateAIRephrases(
    originalText: string
  ): Promise<string[]> {
    try {
      // First, try to use our improved local rephrasing methods
      const localSuggestions = this.generateLocalRephrases(originalText);

      // If we have good local suggestions, return them
      if (localSuggestions.length >= 2) {
        // Add an AI-generated suggestion as backup if API is available
        try {
          const aiSuggestion = await this.generateAISuggestion(originalText);
          if (
            aiSuggestion &&
            !this.isTooSimilar(localSuggestions, aiSuggestion)
          ) {
            return [...localSuggestions, aiSuggestion];
          }
          return localSuggestions;
        } catch (aiError: any) {
          logger.warn("AI service unavailable, using local rephrasing only", {
            error: aiError.message,
          });
          return localSuggestions;
        }
      }

      // If local rephrasing didn't produce enough suggestions, fall back to AI
      const prompt = `Provide 3 different ways to rewrite the following text to improve clarity, academic tone, and uniqueness. Ensure the new versions reflect a distinct voice while maintaining the original meaning. Return only the rephrased versions, numbered 1-3:

Original text: "${originalText}"

Rephrased versions:`;

      const response = await OpenAIService.generateCompletion(prompt, {
        maxTokens: 300,
        temperature: 0.7,
      });

      // Parse the response into individual suggestions
      const suggestions = this.parseSuggestions(response);

      return suggestions.slice(0, 5); // Return max 5 suggestions
    } catch (error: any) {
      logger.error("Error generating AI rephrases", { error: error.message });

      // Fallback: use only local rephrasing methods
      const localOnly = this.generateLocalRephrases(originalText);

      // If local rephasing also failed to produce results (e.g. text too short), use generic fallback
      if (localOnly.length === 0) {
        return this.generateFallbackSuggestions(originalText);
      }

      return localOnly;
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
        // If similarity is over 80%, consider it too similar
        return true;
      }
    }
    return false;
  }

  /**
   * Replace words with synonyms
   */
  private static replaceSynonyms(text: string): string {
    // Basic synonym dictionary - in a real implementation, this would be more comprehensive
    const synonyms: Record<string, string[]> = {
      important: ["significant", "crucial", "vital", "essential", "key"],
      analyze: ["examine", "investigate", "study", "evaluate", "assess"],
      demonstrate: ["show", "illustrate", "prove", "exhibit", "reveal"],
      significant: [
        "substantial",
        "considerable",
        "notable",
        "important",
        "meaningful",
      ],
      research: [
        "study",
        "investigation",
        "enquiry",
        "exploration",
        "examination",
      ],
      therefore: [
        "thus",
        "consequently",
        "accordingly",
        "as a result",
        "hence",
      ],
      however: [
        "nevertheless",
        "nonetheless",
        "on the other hand",
        "yet",
        "although",
      ],
      moreover: [
        "furthermore",
        "additionally",
        "also",
        "besides",
        "what's more",
      ],
      conclude: ["deduce", "infer", "determine", "establish", "summarize"],
    };

    let result = text;

    // Simple replacement - pick first synonym for each match
    Object.entries(synonyms).forEach(([word, replacements]) => {
      const regex = new RegExp("\b" + word + "\b", "gi");
      result = result.replace(regex, replacements[0]);
    });

    return result;
  }

  /**
   * Restructure sentences (simple implementation)
   */
  private static restructureSentence(text: string): string {
    // Convert simple "A because B" to "B, therefore A" or vice versa
    let result = text.replace(/(\w+) because (\w+)/gi, "$2, therefore $1");
    result = result.replace(/(\w+), therefore (\w+)/gi, "$2 because $1");

    // Move introductory phrases
    result = result.replace(/^(\w+), (\w+ \w+)/, "$2, $1,");

    return result;
  }

  /**
   * Transform voice between active and passive
   */
  private static transformVoice(text: string): string {
    // Very basic implementation - convert some simple active to passive
    // In a real implementation, this would use NLP to properly identify subjects, verbs, objects
    let result = text.replace(/(\w+) studies/gi, "studies are conducted by $1");
    result = result.replace(/(\w+) analyzes/gi, "analyses are performed by $1");
    result = result.replace(/(\w+) demonstrates/gi, "it is demonstrated by $1");

    // Passive to active
    result = result.replace(/are conducted by (\w+)/gi, "$1 conducts");
    result = result.replace(/are performed by (\w+)/gi, "$1 performs");
    result = result.replace(/is demonstrated by (\w+)/gi, "$1 demonstrates");

    return result;
  }

  /**
   * Paraphrase common academic phrases
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
      "it is important to note": "significantly",
      "the purpose of this study": "this research aims to",
    };

    let result = text;

    Object.entries(phraseReplacements).forEach(([phrase, replacement]) => {
      const regex = new RegExp(phrase, "gi");
      result = result.replace(regex, replacement);
    });

    return result;
  }

  /**
   * Adjust to more academic tone
   */
  private static adjustAcademicTone(text: string): string {
    // Make language more formal
    let result = text.replace(/\bi\b/g, "one");
    result = result.replace(/\byou\b/g, "one");
    result = result.replace(/\bwe\b/g, "researchers");
    result = result.replace(/\bthink\b/g, "consider");
    result = result.replace(/\bsay\b/g, "suggest");
    result = result.replace(/\bseems\b/g, "appears");

    return result;
  }

  /**
   * Generate a single AI suggestion to supplement local rephrases
   */
  private static async generateAISuggestion(
    originalText: string
  ): Promise<string | null> {
    try {
      const prompt = `Rewrite the following text to improve clarity and academic tone while maintaining the original meaning. Provide only one rephrased version:

Original: "${originalText}"

Rephrased:`;

      const response = await OpenAIService.generateCompletion(prompt, {
        maxTokens: 200,
        temperature: 0.6,
      });

      // Clean up the response
      const cleaned = response.trim().replace(/^Rephrased:\s*/i, "");

      return cleaned;
    } catch (error) {
      logger.warn("AI suggestion generation failed", { error });
      return null;
    }
  }

  /**
   * Parse AI response into individual suggestions
   */
  private static parseSuggestions(response: string): string[] {
    // Split by numbers (1., 2., 3., etc.) or newlines
    const lines = response
      .split(/\n/)
      .map((line) => line.trim())
      .filter((line: string) => line.length > 0);

    const suggestions: string[] = [];

    for (const line of lines) {
      // Remove numbering (1., 2., etc.)
      const cleaned = line.replace(/^\d+[\.\)]\s*/, "").trim();

      if (cleaned.length > 10) {
        // Only add if it's a substantial suggestion
        suggestions.push(cleaned);
      }
    }

    return suggestions;
  }

  /**
   * Generate fallback suggestions if AI fails
   */
  private static generateFallbackSuggestions(originalText: string): string[] {
    // Simple fallback: provide basic rephrasing tips
    return [
      `Consider rephrasing: ${originalText}`,
      `Try using synonyms and restructuring this sentence.`,
      `Rewrite this in your own words while keeping the meaning.`,
    ];
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
