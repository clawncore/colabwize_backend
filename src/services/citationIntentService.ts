import { initializePrisma } from "../lib/prisma-async";
import logger from "../monitoring/logger";
import axios from "axios";
import { SecretsService } from "./secrets-service";
import { config } from "../config/env";

export type CitationIntent = "supporting" | "contrasting" | "background" | "methodology";

export interface CitationIntentResult {
    type: CitationIntent;
    confidence: number;
    context: string;
    reasoning?: string;
}

export class CitationIntentService {
    /**
     * Analyze the intent/role of a citation based on surrounding context
     */
    static async classifyCitationIntent(
        citationId: string,
        contextText: string
    ): Promise<CitationIntentResult> {
        try {
            // Get API key
            const apiKey = await SecretsService.getOpenAiApiKey() || config.openai?.apiKey;
            if (!apiKey) {
                throw new Error("OpenAI API key not configured");
            }

            // Extract 2-3 sentences around the citation (context already provided)
            const trimmedContext = contextText.trim().slice(0, 500); // Limit to 500 chars

            // Use LLM to classify intent
            const prompt = `Analyze how this citation is being used in the following context:

Context:
"${trimmedContext}"

Classify the citation's role as ONE of:
1. "supporting" - The citation provides evidence that supports the author's claim
2. "contrasting" - The citation presents an opposing view or contradicts the claim
3. "background" - The citation provides general background information or context
4. "methodology" - The citation describes a method, tool, or framework being used

Respond in JSON format:
{
  "type": "supporting" | "contrasting" | "background" | "methodology",
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation"
}`;

            const response = await axios.post(
                "https://api.openai.com/v1/chat/completions",
                {
                    model: "gpt-4o-mini",
                    messages: [
                        {
                            role: "system",
                            content: "You are an expert academic writing analyst. Classify citation intent accurately and concisely."
                        },
                        {
                            role: "user",
                            content: prompt
                        }
                    ],
                    temperature: 0.3,
                    max_tokens: 150,
                    response_format: { type: "json_object" }
                },
                {
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${apiKey}`
                    },
                    timeout: 30000
                }
            );

            const result = JSON.parse(response.data.choices[0].message.content || "{}");

            logger.info("Citation intent classified", {
                citationId,
                intent: result.type,
                confidence: result.confidence
            });

            return {
                type: result.type || "background",
                confidence: result.confidence || 0.5,
                context: trimmedContext,
                reasoning: result.reasoning
            };

        } catch (error: any) {
            logger.error("Failed to classify citation intent", {
                citationId,
                error: error.message
            });

            // Return default classification on error
            return {
                type: "background",
                confidence: 0.0,
                context: contextText.slice(0, 500),
                reasoning: "Classification failed - defaulted to background"
            };
        }
    }

    /**
     * Batch classify intents for multiple citations
     */
    static async batchClassifyIntents(
        citations: Array<{ id: string; context: string }>
    ): Promise<Map<string, CitationIntentResult>> {
        const results = new Map<string, CitationIntentResult>();

        // Process in parallel with limit to avoid rate limits
        const batchSize = 5;
        for (let i = 0; i < citations.length; i += batchSize) {
            const batch = citations.slice(i, i + batchSize);
            const promises = batch.map(c =>
                this.classifyCitationIntent(c.id, c.context)
                    .then(result => ({ id: c.id, result }))
            );

            const batchResults = await Promise.all(promises);
            batchResults.forEach(({ id, result }) => {
                results.set(id, result);
            });
        }

        return results;
    }

    /**
     * Get intent statistics for a project
     */
    static getIntentStatistics(intents: Map<string, CitationIntentResult>) {
        const stats = {
            supporting: 0,
            contrasting: 0,
            background: 0,
            methodology: 0,
            total: intents.size
        };

        intents.forEach(intent => {
            stats[intent.type]++;
        });

        return {
            ...stats,
            percentages: {
                supporting: (stats.supporting / stats.total * 100).toFixed(1),
                contrasting: (stats.contrasting / stats.total * 100).toFixed(1),
                background: (stats.background / stats.total * 100).toFixed(1),
                methodology: (stats.methodology / stats.total * 100).toFixed(1)
            }
        };
    }
}
