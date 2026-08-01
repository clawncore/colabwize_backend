"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SemanticClaimService = void 0;
const openaiService_1 = require("../openaiService");
const logger_1 = __importDefault(require("../../monitoring/logger"));
/**
 * Service to evaluate if a document claim is supported by a cited source's abstract
 */
class SemanticClaimService {
    /**
     * Verify a claim against a source abstract using LLM
     * STRICT MODE: Conservative, probabilistic language required.
     */
    static async verifyClaim(claim, abstract) {
        if (!claim || !abstract) {
            return { status: "UNRELATED", reasoning: "Insufficient information to evaluate claim.", confidence: 0 };
        }
        const prompt = `
You are an academic verification assistant. Your job is to check if a specific claim is supported by a paper's abstract.
BE CONSERVATIVE and SKEPTICAL. Do not hallucinate support.

CLAIM: "${claim.substring(0, 500)}"
ABSTRACT: "${abstract.substring(0, 2000)}"

INSTRUCTIONS:
Determine if the abstract supports the claim.
- "SUPPORTED": The abstract EXPLICITLY contains findings or arguments that back the claim.
- "PARTIALLY_SUPPORTED": The abstract is relevant and suggests the claim might be true, or supports a weaker version of it.
- "DISPUTED": The abstract EXPLICITLY contradicts the claim.
- "UNRELATED": The abstract discusses a different topic or does not contain enough info to judge.

Output strict JSON:
{
  "status": "SUPPORTED" | "PARTIALLY_SUPPORTED" | "DISPUTED" | "UNRELATED",
  "reasoning": "A short, neutral sentence explaining the link. Use probabilistic language like 'suggests', 'indicates', 'mentions'. Avoid absolute terms like 'proves'.",
  "confidence": <number between 0.0 and 1.0 reflecting how sure you are of this judgment>
}
`;
        try {
            const response = await openaiService_1.OpenAIService.generateCompletion(prompt, {
                maxTokens: 150,
                temperature: 0.1, // Low temperature for consistency
                model: "gpt-3.5-turbo"
            });
            // Extract JSON from response
            const jsonStr = response.replace(/```json|```/g, "").trim();
            const result = JSON.parse(jsonStr);
            return {
                status: result.status,
                reasoning: result.reasoning,
                confidence: typeof result.confidence === 'number' ? result.confidence : 0.5
            };
        }
        catch (error) {
            logger_1.default.error("Error in SemanticClaimService.verifyClaim", {
                error: error.message,
                claim: claim.substring(0, 50) + "..."
            });
            return {
                status: "UNRELATED",
                reasoning: "Semantic verification service encountered an error.",
                confidence: 0
            };
        }
    }
}
exports.SemanticClaimService = SemanticClaimService;
