"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HumanizerService = void 0;
const anthropicService_1 = require("./anthropicService");
const openaiService_1 = require("./openaiService");
const logger_1 = __importDefault(require("../monitoring/logger"));
const adversarialPrompt_1 = require("../prompts/adversarialPrompt");
class HumanizerService {
    /**
     * Humanize text using Dual-Engine Architecture
     * Primary: Anthropic (Claude 3.5 Sonnet) - Best for evasion
     * Fallback: OpenAI (GPT-4o) - Reliable backup
     */
    static async humanizeText(text) {
        // 1. Attempt Primary (Anthropic)
        try {
            logger_1.default.info("Attempting humanization with Anthropic...");
            const result = await anthropicService_1.AnthropicService.humanizeText(text);
            // Expected format: JSON array of strings
            try {
                let cleanResult = result.trim();
                if (cleanResult.startsWith("```json")) {
                    cleanResult = cleanResult.replace(/```json\n?/, "").replace(/\n?```/, "");
                }
                else if (cleanResult.startsWith("```")) {
                    cleanResult = cleanResult.replace(/```\n?/, "").replace(/\n?```/, "");
                }
                const variations = JSON.parse(cleanResult);
                if (Array.isArray(variations)) {
                    return {
                        variations,
                        provider: "anthropic"
                    };
                }
            }
            catch (pE) {
                logger_1.default.warn("Failed to parse Anthropic JSON, returning as single variation", { response: result });
            }
            return {
                variations: [result],
                provider: "anthropic"
            };
        }
        catch (anthropicError) {
            logger_1.default.warn("Anthropic Humanization failed, attempting fallback to OpenAI", { error: anthropicError.message });
        }
        // 2. Attempt Fallback (OpenAI)
        try {
            logger_1.default.info("Attempting humanization with OpenAI (Fallback)...");
            const combinedPrompt = `
SYSTEM INSTRUCTIONS:
${adversarialPrompt_1.ADVERSARIAL_SYSTEM_PROMPT}

USER REQUEST:
${(0, adversarialPrompt_1.constructHumanizeUserPrompt)(text)}
`;
            const result = await openaiService_1.OpenAIService.generateCompletion(combinedPrompt, {
                model: "gpt-3.5-turbo", // Use GPT-3.5-turbo for wider compatibility
                maxTokens: 2000,
                temperature: 0.7
            });
            try {
                let cleanResult = result.trim();
                if (cleanResult.startsWith("```json")) {
                    cleanResult = cleanResult.replace(/```json\n?/, "").replace(/\n?```/, "");
                }
                else if (cleanResult.startsWith("```")) {
                    cleanResult = cleanResult.replace(/```\n?/, "").replace(/\n?```/, "");
                }
                const variations = JSON.parse(cleanResult);
                if (Array.isArray(variations)) {
                    return {
                        variations,
                        provider: "openai"
                    };
                }
            }
            catch (pE) {
                logger_1.default.warn("Failed to parse OpenAI JSON, returning as single variation", { response: result });
            }
            return {
                variations: [result],
                provider: "openai"
            };
        }
        catch (openaiError) {
            logger_1.default.error("All humanization providers failed", { openaiError: openaiError.message });
            throw new Error("Failed to humanize text. Please try again later.");
        }
    }
    /**
     * In-Line Rewrite: Humanize a specific selection while preserving context
     * Used for the editor's "Humanize This" tooltip.
     */
    static async rewriteSelection(selection, surroundingContext) {
        return this.humanizeText(selection);
    }
}
exports.HumanizerService = HumanizerService;
