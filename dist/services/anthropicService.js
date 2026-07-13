"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnthropicService = void 0;
const axios_1 = __importDefault(require("axios"));
const secrets_service_1 = require("./secrets-service");
const logger_1 = __importDefault(require("../monitoring/logger"));
const adversarialPrompt_1 = require("../prompts/adversarialPrompt");
class AnthropicService {
    static API_URL = "https://api.anthropic.com/v1/messages";
    static MODEL = "claude-3-5-sonnet-20240620";
    /**
     * Humanize text using Claude 3.5 Sonnet (Adversarial Mode)
     */
    static async humanizeText(text) {
        try {
            const apiKey = await secrets_service_1.SecretsService.getAnthropicApiKey();
            if (!apiKey) {
                throw new Error("Anthropic API Key not configured");
            }
            const response = await axios_1.default.post(this.API_URL, {
                model: this.MODEL,
                max_tokens: 4096,
                system: adversarialPrompt_1.ADVERSARIAL_SYSTEM_PROMPT,
                messages: [
                    { role: "user", content: (0, adversarialPrompt_1.constructHumanizeUserPrompt)(text) }
                ]
            }, {
                headers: {
                    "x-api-key": apiKey,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json"
                }
            });
            if (response.data && response.data.content && response.data.content[0]) {
                return response.data.content[0].text.trim();
            }
            throw new Error("Invalid response format from Anthropic API");
        }
        catch (error) {
            logger_1.default.error("Anthropic Humanize Failed", { error: error.message });
            // Re-throw so the Orchestrator can handle the fallback
            throw error;
        }
    }
}
exports.AnthropicService = AnthropicService;
