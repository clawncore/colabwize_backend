import { OpenAIService } from "./openaiService";
import logger from "../monitoring/logger";

export interface GrammarError {
    original: string;
    suggestion: string;
    type: "spelling" | "grammar" | "style" | "capitalization" | "punctuation";
    explanation: string;
    offset?: number; // Potential future use
    length?: number; // Potential future use
}

export class GrammarService {
    /**
     * Analyze text for grammar, spelling, and style errors
     */
    static async checkGrammar(text: string): Promise<GrammarError[]> {
        try {
            if (!text || text.trim().length < 5) {
                return [];
            }

            const prompt = `
      Analyze the following text ONLY for SPELLING and PUNCTUATION errors.
      
      Return a JSON array of objects with the following structure:
      [
        {
          "original": "substring with error",
          "suggestion": "corrected substring",
          "type": "spelling" | "punctuation",
          "explanation": "Brief explanation of why this is an error"
        }
      ]

      Rules:
      1. Returns ONLY valid JSON. No markdown formatting.
      2. If no errors are found, return an empty array [].
      3. IGNORE style issues (passive voice, wordiness, etc.).
      4. IGNORE complex grammar issues involved with sentence structure.
      5. FOCUS STRICTLY on typos, misspellings, and missing/incorrect punctuation.
      6. "original" text must EXACTLY match the text in the input.

      Text to analyze:
      "${text}"
      `;

            const response = await OpenAIService.generateCompletion(prompt, {
                temperature: 0.1, // Low temperature for deterministic results
                model: "gpt-4o-mini", // Use a fast/cost-effective model if available, or gpt-3.5-turbo
                maxTokens: 1000,
            });

            // Clean response (remove markdown code blocks if present)
            const cleanJson = response.replace(/^```json\s*|\s*```$/g, "");

            const errors: GrammarError[] = JSON.parse(cleanJson);
            return errors;

        } catch (error) {
            logger.error("Grammar check failed", { error });
            return [];
        }
    }
}
