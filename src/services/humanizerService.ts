import { AnthropicService } from "./anthropicService";
import { OpenAIService } from "./openaiService";
import logger from "../monitoring/logger";
import { ADVERSARIAL_SYSTEM_PROMPT, constructHumanizeUserPrompt } from "../prompts/adversarialPrompt";

interface HumanizationResult {
    text: string;
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
            return {
                text: result,
                provider: "anthropic"
            };
        } catch (anthropicError: any) {
            logger.warn("Anthropic Humanization failed, attempting fallback to OpenAI", { error: anthropicError.message });
        }

        // 2. Attempt Fallback (OpenAI)
        try {
            logger.info("Attempting humanization with OpenAI (Fallback)...");

            // Construct OpenAI-compatible messages
            // We use the same system prompt to try and enforce the same behavior
            /* 
               Note: OpenAIService.generateCompletion takes a string prompt usually, 
               but we should eventually enhance it to take messages or use the prompt carefully.
               For now, we'll combine System + User into a single prompt string if the service is simple,
               OR we update OpenAIService to be smarter.
               
               Looking at OpenAIService.generateCompletion, it takes a prompt string but sends it as a user message.
               Wait, looking at the code:
               messages: [{ role: "user", content: prompt }]
               
               It lacks system message support in the current helper.
               We'll wrap the instruction in the user prompt for now to avoid modifying OpenAIService too heavily 
               OR we can just instantiate a raw axios call here for full control, 
               OR better: we add a dedicated method to OpenAIService?
               
               Let's trust the current OpenAIService for now but prepend the instructions.
            */

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

            return {
                text: result,
                provider: "openai"
            };

        } catch (openaiError: any) {
            logger.error("All humanization providers failed", { openaiError: openaiError.message });
            throw new Error("Failed to humanize text. Please try again later.");
        }
    }
}
