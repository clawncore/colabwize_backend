"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AIDetectionService = void 0;
const logger_1 = __importDefault(require("../monitoring/logger"));
class AIDetectionService {
    /**
     * Detect AI-generated content in a document using GPTZero API
     */
    static async detectAI(content) {
        const GPTZERO_API_KEY = process.env.GPTZERO_API_KEY;
        if (!GPTZERO_API_KEY) {
            logger_1.default.error("GPTZero API key not configured");
            throw new Error("AI detection service is not configured. Please contact support.");
        }
        try {
            logger_1.default.info("Starting AI detection scan with GPTZero", {
                contentLength: content.length
            });
            return await this.detectWithGPTZero(content, GPTZERO_API_KEY);
        }
        catch (error) {
            logger_1.default.error("Error in AI detection service", {
                error: error.message,
                stack: error.stack
            });
            throw new Error(`AI detection failed: ${error.message}`);
        }
    }
    /**
     * Professional Detection via GPTZero API
     */
    static async detectWithGPTZero(content, apiKey) {
        const axios = (await import("axios")).default;
        try {
            const response = await axios.post("https://api.gptzero.me/v2/predict/text", { document: content }, {
                headers: {
                    "x-api-key": apiKey,
                    "Content-Type": "application/json",
                },
                timeout: 30000, // 30 second timeout
            });
            const data = response.data;
            // Validate response structure
            if (!data.documents || !data.documents[0]) {
                throw new Error("Invalid response from GPTZero API");
            }
            const doc = data.documents[0];
            const overallScore = (doc.completely_generated_prob || 0) * 100;
            // Map sentences with position tracking
            let currentPosition = 0;
            const sentences = (doc.sentences || []).map((s) => {
                const score = (s.generated_prob || 0) * 100;
                const sentenceText = s.sentence || "";
                // Find sentence position in content
                const positionStart = content.indexOf(sentenceText, currentPosition);
                const positionEnd = positionStart >= 0
                    ? positionStart + sentenceText.length
                    : currentPosition + sentenceText.length;
                currentPosition = positionEnd;
                return {
                    text: sentenceText,
                    score: score,
                    classification: this.classifySentence(score),
                    positionStart: Math.max(0, positionStart),
                    positionEnd: positionEnd,
                };
            });
            logger_1.default.info("GPTZero scan completed", {
                overallScore,
                sentenceCount: sentences.length
            });
            return {
                overallScore,
                classification: this.classifyOverall(overallScore),
                sentences,
                scannedAt: new Date(),
            };
        }
        catch (error) {
            if (error.response) {
                logger_1.default.error("GPTZero API error", {
                    status: error.response.status,
                    data: error.response.data
                });
                if (error.response.status === 401) {
                    throw new Error("Invalid GPTZero API key");
                }
                else if (error.response.status === 429) {
                    throw new Error("GPTZero API rate limit exceeded. Please try again later.");
                }
                else {
                    throw new Error(`GPTZero API error: ${error.response.data?.message || error.message}`);
                }
            }
            throw error;
        }
    }
    static classifySentence(score) {
        if (score < 20)
            return "human";
        if (score < 50)
            return "likely_human";
        if (score < 80)
            return "likely_ai";
        return "ai";
    }
    static classifyOverall(score) {
        if (score < 30)
            return "human";
        if (score < 70)
            return "mixed";
        return "ai";
    }
}
exports.AIDetectionService = AIDetectionService;
