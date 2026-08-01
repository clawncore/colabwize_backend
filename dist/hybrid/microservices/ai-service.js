"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AIService = void 0;
// Microservice for AI-powered features
const generative_ai_1 = require("@google/generative-ai");
const secrets_service_1 = require("../../services/secrets-service");
const prisma_1 = require("../../lib/prisma");
const logger_1 = __importDefault(require("../../monitoring/logger"));
// Initialize Google Generative AI client
let genAI = null;
// Lazy initialization of Google Generative AI client
async function getGeminiClient() {
    if (!genAI) {
        const apiKey = await secrets_service_1.SecretsService.getOpenAiApiKey(); // We'll reuse this for Gemini
        if (!apiKey) {
            throw new Error("Gemini API key not configured");
        }
        genAI = new generative_ai_1.GoogleGenerativeAI(apiKey);
    }
    return genAI;
}
class AIService {
    // Grammar and style checking
    static async checkGrammar(text) {
        try {
            const client = await getGeminiClient();
            const model = client.getGenerativeModel({ model: "gemini-1.5-pro" });
            const result = await model.generateContent([
                "You are an academic writing assistant. Check grammar and suggest improvements in academic tone.",
                `Review this text: "${text}"`,
            ]);
            const responseText = result.response?.text() || "No suggestions available.";
            const resultData = {
                suggestions: responseText,
                tokensUsed: responseText.length, // Approximation
                cost: this.calculateCost(responseText.length, "gemini-1.5-pro"),
            };
            return resultData;
        }
        catch (error) {
            throw new Error(`AI grammar check failed: ${error.message}`);
        }
    }
    // Writing assistant
    static async improveWriting(text) {
        try {
            const client = await getGeminiClient();
            const model = client.getGenerativeModel({ model: "gemini-1.5-pro" });
            const result = await model.generateContent([
                "Improve this academic text while maintaining the author's voice. Make it more scholarly and clear.",
                text,
            ]);
            const responseText = result.response?.text() || "No improvements available.";
            const resultData = {
                improvedText: responseText,
                tokensUsed: responseText.length, // Approximation
                cost: this.calculateCost(responseText.length, "gemini-1.5-pro"),
            };
            return resultData;
        }
        catch (error) {
            throw new Error(`AI writing improvement failed: ${error.message}`);
        }
    }
    // Paraphrasing
    static async paraphraseText(text) {
        try {
            const client = await getGeminiClient();
            const model = client.getGenerativeModel({ model: "gemini-1.5-pro" });
            const result = await model.generateContent([
                "Paraphrase the following academic text while maintaining the original meaning and scholarly tone.",
                text,
            ]);
            const responseText = result.response?.text() || "No paraphrased text available.";
            const resultData = {
                paraphrasedText: responseText,
                tokensUsed: responseText.length, // Approximation
                cost: this.calculateCost(responseText.length, "gemini-1.5-pro"),
            };
            return resultData;
        }
        catch (error) {
            throw new Error(`AI paraphrasing failed: ${error.message}`);
        }
    }
    // Research question generation
    static async generateResearchQuestions(topic, count = 5) {
        try {
            const client = await getGeminiClient();
            const model = client.getGenerativeModel({ model: "gemini-1.5-pro" });
            const result = await model.generateContent([
                `Generate ${count} research questions for the following topic. Make them specific, researchable, and relevant to academic study.`,
                topic,
            ]);
            const responseText = result.response?.text() || "No research questions generated.";
            const resultData = {
                questions: responseText,
                tokensUsed: responseText.length, // Approximation
                cost: this.calculateCost(responseText.length, "gemini-1.5-pro"),
            };
            return resultData;
        }
        catch (error) {
            throw new Error(`AI research question generation failed: ${error.message}`);
        }
    }
    // Outline generation
    static async generateOutline(topic, structure = "standard") {
        try {
            const client = await getGeminiClient();
            const model = client.getGenerativeModel({ model: "gemini-1.5-pro" });
            const result = await model.generateContent([
                `Create a detailed ${structure} academic outline for the following topic. Include main sections, subsections, and brief descriptions.`,
                topic,
            ]);
            const responseText = result.response?.text() || "No outline generated.";
            const resultData = {
                outline: responseText,
                tokensUsed: responseText.length, // Approximation
                cost: this.calculateCost(responseText.length, "gemini-1.5-pro"),
            };
            return resultData;
        }
        catch (error) {
            throw new Error(`AI outline generation failed: ${error.message}`);
        }
    }
    // Source finding
    static async findSources(topic, count = 5) {
        try {
            const client = await getGeminiClient();
            const model = client.getGenerativeModel({ model: "gemini-1.5-pro" });
            const result = await model.generateContent([
                `Suggest ${count} academic sources (books, papers, articles) for the following topic. Include titles, authors, and brief descriptions of relevance.`,
                topic,
            ]);
            const responseText = result.response?.text() || "No sources found.";
            const resultData = {
                sources: responseText,
                tokensUsed: responseText.length, // Approximation
                cost: this.calculateCost(responseText.length, "gemini-1.5-pro"),
            };
            return resultData;
        }
        catch (error) {
            throw new Error(`AI source finding failed: ${error.message}`);
        }
    }
    // Citation generation
    static async generateCitations(sources, style = "APA") {
        try {
            const client = await getGeminiClient();
            const model = client.getGenerativeModel({ model: "gemini-1.5-pro" });
            const result = await model.generateContent([
                `Generate properly formatted citations in ${style} style for the following sources:`,
                sources,
            ]);
            const responseText = result.response?.text() || "No citations generated.";
            const resultData = {
                citations: responseText,
                tokensUsed: responseText.length, // Approximation
                cost: this.calculateCost(responseText.length, "gemini-1.5-pro"),
            };
            return resultData;
        }
        catch (error) {
            throw new Error(`AI citation generation failed: ${error.message}`);
        }
    }
    // Plagiarism checking
    static async checkPlagiarism(text) {
        try {
            const client = await getGeminiClient();
            const model = client.getGenerativeModel({ model: "gemini-1.5-pro" });
            const result = await model.generateContent([
                "Analyze the following text for potential plagiarism concerns. Identify any sections that might raise flags and suggest ways to properly attribute or rephrase the content.",
                text,
            ]);
            const responseText = result.response?.text() || "No plagiarism concerns detected.";
            const resultData = {
                analysis: responseText,
                tokensUsed: responseText.length, // Approximation
                cost: this.calculateCost(responseText.length, "gemini-1.5-pro"),
            };
            return resultData;
        }
        catch (error) {
            throw new Error(`AI plagiarism check failed: ${error.message}`);
        }
    }
    // Cost calculation (approximate)
    static calculateCost(tokens, model) {
        // Actual Gemini pricing (as of 2024)
        // Gemini 1.5 Pro: $7.00 per 1M input tokens, $21.00 per 1M output tokens
        // Gemini 1.5 Flash: $0.70 per 1M input tokens, $2.10 per 1M output tokens
        // For simplicity, we'll use an average cost per token
        let costPerMillionTokens = 0;
        if (model.includes("gemini-1.5-pro") || model.includes("gemini-pro")) {
            // Gemini 1.5 Pro pricing
            // Using average of input/output pricing: ($7.00 + $21.00) / 2 = $14.00 per 1M tokens
            costPerMillionTokens = 14.0;
        }
        else if (model.includes("gemini-1.5-flash") ||
            model.includes("gemini-flash")) {
            // Gemini 1.5 Flash pricing
            // Using average of input/output pricing: ($0.70 + $2.10) / 2 = $1.40 per 1M tokens
            costPerMillionTokens = 1.4;
        }
        else if (model.includes("gemini")) {
            // Default Gemini pricing (fallback)
            // Using a conservative estimate of $7.00 per 1M tokens
            costPerMillionTokens = 7.0;
        }
        else {
            // Default fallback for other models
            // Using $10.00 per 1M tokens as a conservative estimate
            costPerMillionTokens = 10.0;
        }
        // Calculate cost: (tokens / 1,000,000) * costPerMillionTokens
        return (tokens / 1000000) * costPerMillionTokens;
    }
    // Track AI usage for billing and analytics
    static async trackUsage(userId, feature, tokensUsed, cost) {
        try {
            // Get current date for monthly tracking
            const now = new Date();
            const month = now.getMonth() + 1; // JavaScript months are 0-indexed
            const year = now.getFullYear();
            // Update or create AI usage record for the user
            const usageRecord = await prisma_1.prisma.aIUsage.upsert({
                where: {
                    user_id_month_year: {
                        user_id: userId,
                        month: month,
                        year: year,
                    },
                },
                update: {
                    request_count: {
                        increment: 1,
                    },
                    [this.getFeatureCounterField(feature)]: {
                        increment: 1,
                    },
                    updated_at: new Date(),
                },
                create: {
                    user_id: userId,
                    month: month,
                    year: year,
                    request_count: 1,
                    [this.getFeatureCounterField(feature)]: 1,
                },
            });
            // Also track cost for analytics
            await prisma_1.prisma.aICostTracking.create({
                data: {
                    user_id: userId,
                    model: "gpt-4o-mini", // Default model, could be dynamic
                    tokens_used: tokensUsed,
                    cost: cost,
                    request_type: feature,
                    timestamp: new Date(),
                },
            });
            // Log the usage
            logger_1.default.info("AI usage tracked", {
                userId,
                feature,
                tokensUsed,
                cost,
                usageRecordId: usageRecord.id,
            });
            return usageRecord.id;
        }
        catch (error) {
            logger_1.default.error("Failed to track AI usage", {
                error: error.message,
                userId,
                feature,
                tokensUsed,
                cost,
            });
            throw new Error(`Failed to track AI usage: ${error.message}`);
        }
    }
    // Helper method to map feature names to counter fields
    static getFeatureCounterField(feature) {
        const featureMap = {
            grammar_check: "request_count",
            writing_improvement: "request_count",
            paraphrasing: "request_count",
            research_questions: "request_count",
            chat_message: "chat_message_count",
            image_generation: "image_generation_count",
            web_search: "web_search_count",
            deep_search: "deep_search_count",
        };
        return featureMap[feature] || "request_count";
    }
}
exports.AIService = AIService;
