import { OpenAIService } from "../openaiService";
import logger from "../../monitoring/logger";

export type SemanticSupportStatus = "SUPPORTED" | "DISPUTED" | "PARTIALLY_SUPPORTED" | "UNRELATED";

export interface SemanticSupportResult {
    status: SemanticSupportStatus;
    reasoning: string;
}

/**
 * Service to evaluate if a document claim is supported by a cited source's abstract
 */
export class SemanticClaimService {
    /**
     * Verify a claim against a source abstract using LLM
     */
    static async verifyClaim(claim: string, abstract: string): Promise<SemanticSupportResult> {
        if (!claim || !abstract) {
            return { status: "UNRELATED", reasoning: "Insufficient information to evaluate claim." };
        }

        const prompt = `
Evaluate if the following document claim is supported by the provided research paper abstract.

DOCUMENT CLAIM:
"${claim}"

PAPER ABSTRACT:
"${abstract}"

DECISION CRITERIA:
- SUPPORTED: The abstract directly confirms or strongly supports the specific claim.
- DISPUTED: The abstract contradicts the claim or provides evidence against it.
- PARTIALLY_SUPPORTED: The abstract supports some part of the claim or suggests it under specific conditions, but isn't a direct 1:1 match.
- UNRELATED: The abstract is about a different topic and doesn't mention the claim's core subject.

Return your response as a JSON object with two fields:
1. "status": One of "SUPPORTED", "DISPUTED", "PARTIALLY_SUPPORTED", "UNRELATED".
2. "reasoning": A one-sentence explanation of why you chose this status.

JSON:`;

        try {
            const response = await OpenAIService.generateCompletion(prompt, {
                maxTokens: 150,
                temperature: 0.3,
                model: "gpt-3.5-turbo" // Using 3.5 for speed/cost, can upgrade to gpt-4o if needed
            });

            // Extract JSON from response
            const jsonStr = response.replace(/```json|```/g, "").trim();
            const result = JSON.parse(jsonStr);

            return {
                status: result.status as SemanticSupportStatus,
                reasoning: result.reasoning
            };

        } catch (error: any) {
            logger.error("Error in SemanticClaimService.verifyClaim", {
                error: error.message,
                claim: claim.substring(0, 50) + "..."
            });
            return {
                status: "UNRELATED",
                reasoning: "Semantic verification service encountered an error."
            };
        }
    }
}
