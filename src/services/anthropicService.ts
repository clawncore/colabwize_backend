import axios from "axios";
import { SecretsService } from "./secrets-service";
import logger from "../monitoring/logger";
import { ADVERSARIAL_SYSTEM_PROMPT, constructHumanizeUserPrompt } from "../prompts/adversarialPrompt";

export class AnthropicService {
    private static readonly API_URL = "https://api.anthropic.com/v1/messages";
    private static readonly MODEL = "claude-3-5-sonnet-20240620";

    /**
     * Humanize text using Claude 3.5 Sonnet (Adversarial Mode)
     */
    static async humanizeText(text: string): Promise<string> {
        try {
            const apiKey = await SecretsService.getAnthropicApiKey();

            if (!apiKey) {
                throw new Error("Anthropic API Key not configured");
            }

            const response = await axios.post(
                this.API_URL,
                {
                    model: this.MODEL,
                    max_tokens: 4096,
                    system: ADVERSARIAL_SYSTEM_PROMPT,
                    messages: [
                        { role: "user", content: constructHumanizeUserPrompt(text) }
                    ]
                },
                {
                    headers: {
                        "x-api-key": apiKey,
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json"
                    }
                }
            );

            if (response.data && response.data.content && response.data.content[0]) {
                return response.data.content[0].text.trim();
            }

            throw new Error("Invalid response format from Anthropic API");

        } catch (error: any) {
            logger.error("Anthropic Humanize Failed", { error: error.message });
            // Re-throw so the Orchestrator can handle the fallback
            throw error;
        }
    }
}
