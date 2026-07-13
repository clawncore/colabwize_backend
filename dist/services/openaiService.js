"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAIService = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = __importDefault(require("../monitoring/logger"));
const env_1 = require("../config/env");
const secrets_service_1 = require("./secrets-service");
/**
 * Lightweight AI service for text generation tasks
 * Used for rephrasing and basic completions
 */
class OpenAIService {
    /**
     * Generate text completion using OpenAI API
     */
    static async generateCompletion(input, options = {}) {
        const { maxTokens = 200, temperature = 0.7, model = "gpt-3.5-turbo", } = options;
        try {
            // Check if OpenAI API key is configured
            const apiKey = (await secrets_service_1.SecretsService.getOpenAiApiKey()) || env_1.config.openai?.apiKey;
            if (!apiKey) {
                logger_1.default.warn("OpenAI API key not configured, using fallback");
                throw new Error("OpenAI API key not configured");
            }
            // Prepare messages
            const messages = Array.isArray(input)
                ? input
                : [{ role: "user", content: input }];
            // Call OpenAI API
            const response = await axios_1.default.post("https://api.openai.com/v1/chat/completions", {
                model,
                messages,
                max_tokens: maxTokens,
                temperature,
            }, {
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${apiKey}`,
                },
                timeout: 30000, // 30 second timeout
            });
            if (response.data?.choices?.[0]?.message?.content) {
                return response.data.choices[0].message.content.trim();
            }
            throw new Error("Invalid response from OpenAI API");
        }
        catch (error) {
            logger_1.default.error("OpenAI API error", {
                error: error.message,
                status: error.response?.status,
            });
            throw error;
        }
    }
    /**
     * Generate multiple rephrase variations
     */
    static async generateRephrases(originalText, count = 3) {
        const prompt = `Provide ${count} different ways to rephrase the following text.
    
CRITICAL INSTRUCTIONS:
- Write mostly in active voice and use natural, varied sentence structures ("burstiness").
- Do NOT use typical AI phrases like "In conclusion", "It is important to note", or "Delve into".
- Make it sound like a knowledgeable human student, not a robot.
- Maintain the original meaning perfectly.

Return only the rephrased versions, numbered 1-${count}:

Original text: "${originalText}"

Rephrased versions:`;
        try {
            const response = await this.generateCompletion(prompt, {
                maxTokens: 300,
                temperature: 0.7,
            });
            // Parse numbered list
            const lines = response
                .split(/\n/)
                .map((line) => line.trim())
                .filter((line) => line.length > 0);
            const rephrases = [];
            for (const line of lines) {
                const cleaned = line.replace(/^\d+[\.\)]\s*/, "").trim();
                if (cleaned.length > 10) {
                    rephrases.push(cleaned);
                }
            }
            return rephrases.slice(0, count);
        }
        catch (error) {
            logger_1.default.error("Error generating rephrases", { error });
            throw error;
        }
    }
}
exports.OpenAIService = OpenAIService;
