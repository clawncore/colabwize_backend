import { AnthropicService } from "./anthropicService";
import { OpenAIService } from "./openaiService";
import logger from "../monitoring/logger";
import { ADVERSARIAL_SYSTEM_PROMPT, constructHumanizeUserPrompt } from "../prompts/adversarialPrompt";

interface HumanizationResult {
    variations: string[];
    provider: "anthropic" | "openai";
}

export class HumanizerService {
    /**
     * Humanize text using Dual-Engine Architecture
     * Primary: Anthropic (Claude 3.5 Sonnet) - Best for evasion
     * Fallback: OpenAI (GPT-4o) - Reliable backup
     */
    static async humanizeText(text: string): Promise<HumanizationResult> {
        // 1. Attempt Primary (Anthropic)
        try {
            logger.info("Attempting humanization with Anthropic...");
            const result = await AnthropicService.humanizeText(text);

            // Expected format: JSON array of strings
            try {
                let cleanResult = result.trim();
                if (cleanResult.startsWith("```json")) {
                    cleanResult = cleanResult.replace(/```json\n?/, "").replace(/\n?```/, "");
                } else if (cleanResult.startsWith("```")) {
                    cleanResult = cleanResult.replace(/```\n?/, "").replace(/\n?```/, "");
                }

                const variations = JSON.parse(cleanResult);
                if (Array.isArray(variations)) {
                    return {
                        variations,
                        provider: "anthropic"
                    };
                }
            } catch (pE) {
                logger.warn("Failed to parse Anthropic JSON, returning as single variation", { response: result });
            }

            return {
                variations: [result],
                provider: "anthropic"
            };
        } catch (anthropicError: any) {
            logger.warn("Anthropic Humanization failed, attempting fallback to OpenAI", { error: anthropicError.message });
        }

        // 2. Attempt Fallback (OpenAI)
        try {
            logger.info("Attempting humanization with OpenAI (Fallback)...");

            const combinedPrompt = `
SYSTEM INSTRUCTIONS:
${ADVERSARIAL_SYSTEM_PROMPT}

USER REQUEST:
${constructHumanizeUserPrompt(text)}
`;

            const result = await OpenAIService.generateCompletion(combinedPrompt, {
                model: "gpt-4o", // Use GPT-4o for best fallback quality
                maxTokens: 4096,
                temperature: 0.7
            });

            try {
                let cleanResult = result.trim();
                if (cleanResult.startsWith("```json")) {
                    cleanResult = cleanResult.replace(/```json\n?/, "").replace(/\n?```/, "");
                } else if (cleanResult.startsWith("```")) {
                    cleanResult = cleanResult.replace(/```\n?/, "").replace(/\n?```/, "");
                }

                const variations = JSON.parse(cleanResult);
                if (Array.isArray(variations)) {
                    return {
                        variations,
                        provider: "openai"
                    };
                }
            } catch (pE) {
                logger.warn("Failed to parse OpenAI JSON, returning as single variation", { response: result });
            }

            return {
                variations: [result],
                provider: "openai"
            };

        } catch (openaiError: any) {
            logger.error("All humanization providers failed", { openaiError: openaiError.message });
            throw new Error("Failed to humanize text. Please try again later.");
        }
    }

    /**
     * In-Line Rewrite: Humanize a specific selection while preserving context
     * Used for the editor's "Humanize This" tooltip.
     */
    static async rewriteSelection(selection: string, surroundingContext?: string): Promise<HumanizationResult> {
        return this.humanizeText(selection);
    }
}

