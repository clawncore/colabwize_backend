"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const prisma_1 = require("../../lib/prisma");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const openaiService_1 = require("../../services/openaiService");
const auth_helpers_1 = require("../../lib/auth-helpers");
const router = express_1.default.Router();
/**
 * POST /api/citations/:projectId/batch-analyze
 * Batch AI Analysis of all project citations for Literature Matrix
 */
router.post("/:projectId/batch-analyze", async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: "Authentication required",
            });
        }
        const { projectId } = req.params;
        const { force = false } = req.body;
        // Verify access to the project
        const hasAccess = await (0, auth_helpers_1.checkProjectAccess)(projectId, userId);
        if (!hasAccess) {
            return res.status(403).json({
                success: false,
                error: "Access denied or project not found",
            });
        }
        // 1. Fetch citations with abstracts
        const citations = await prisma_1.prisma.citation.findMany({
            where: {
                project_id: projectId,
                abstract: { not: null },
                // If not forcing, only analyze those missing data
                ...(force ? {} : {
                    OR: [
                        { themes: { equals: prisma_1.prisma.jsonNull } },
                        { themes: { equals: [] } },
                        { matrix_notes: null },
                        { matrix_notes: "" }
                    ]
                })
            },
            select: { id: true, abstract: true, title: true }
        });
        if (citations.length === 0) {
            return res.status(200).json({
                success: true,
                message: "No citations found requiring analysis",
                data: []
            });
        }
        logger_1.default.info(`Starting batch analysis for ${citations.length} citations`, { projectId, userId });
        const updatedCitations = [];
        // 2. Iterate and analyze
        // For now we process sequentially to avoid overwhelming rate limits, 
        // but could be parallelized with a limit.
        for (const citation of citations) {
            try {
                const prompt = `
Analyze the following academic abstract for a Literature Matrix.
Goal: Identify if the paper explicitly covers a Research Gap, Methodology, or Specific Results.
And provide a brief 1-2 sentence qualitative synthesis (Matrix Notes).

Abstract:
"${citation.abstract.slice(0, 3000)}"

Return ONLY a valid JSON object in this format:
{
  "themes": ["Gap", "Methodology", "Result"], 
  "matrix_notes": "Synthesis text here..."
}
Rules:
- Include "Gap" in themes only if the abstract clearly defines a problem or lack of previous research.
- Include "Methodology" in themes if the abstract describes the study design (e.g., survey, experiment).
- Include "Result" in themes if specific findings are mentioned.
- "matrix_notes" must be a concise (max 30 words) summary of the key contribution.
`;
                const rawResponse = await openaiService_1.OpenAIService.generateCompletion(prompt, {
                    temperature: 0.3,
                    maxTokens: 500
                });
                let analysis;
                try {
                    const cleanJson = rawResponse.replace(/```json/g, "").replace(/```/g, "").trim();
                    analysis = JSON.parse(cleanJson);
                }
                catch (e) {
                    logger_1.default.error(`Failed to parse AI response for citation ${citation.id}`, { rawResponse });
                    continue; // Skip this one
                }
                const updated = await prisma_1.prisma.citation.update({
                    where: { id: citation.id },
                    data: {
                        themes: analysis.themes || [],
                        matrix_notes: analysis.matrix_notes || ""
                    }
                });
                updatedCitations.push(updated);
            }
            catch (err) {
                logger_1.default.error(`Error analyzing individual citation ${citation.id}`, { error: err.message });
            }
        }
        return res.status(200).json({
            success: true,
            message: `Analyzed ${updatedCitations.length} citations`,
            data: updatedCitations
        });
    }
    catch (error) {
        logger_1.default.error("Error in batch analysis", {
            error: error.message,
            stack: error.stack,
        });
        return res.status(500).json({
            success: false,
            error: error.message || "Batch analysis failed",
        });
    }
});
exports.default = router;
