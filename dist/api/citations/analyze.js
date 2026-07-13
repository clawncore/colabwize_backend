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
 * POST /api/citations/:projectId/:citationId/analyze
 * AI Analysis of citation for Literature Matrix
 */
router.post("/:projectId/:citationId/analyze", async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: "Authentication required",
            });
        }
        const { projectId, citationId } = req.params;
        // Verify access to the project
        const hasAccess = await (0, auth_helpers_1.checkProjectAccess)(projectId, userId);
        if (!hasAccess) {
            return res.status(403).json({
                success: false,
                error: "Access denied or project not found",
            });
        }
        const citation = await prisma_1.prisma.citation.findUnique({
            where: { id: citationId },
            select: { id: true, abstract: true, title: true, project_id: true }
        });
        if (!citation || citation.project_id !== projectId) {
            return res.status(404).json({ success: false, error: "Citation not found in this project" });
        }
        if (!citation.abstract) {
            return res.status(400).json({
                success: false,
                error: "Citation has no abstract to analyze. Please edit the citation and add an abstract."
            });
        }
        // Construct Prompt
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
        // Call AI
        // We use generateCompletion. 
        // Ideally we'd validte JSON but for now rely on prompt.
        const rawResponse = await openaiService_1.OpenAIService.generateCompletion(prompt, {
            temperature: 0.3, // Low temperature for deterministic output
            maxTokens: 500
        });
        // Parse JSON
        let analysis;
        try {
            // Remove markdown code blocks if present
            const cleanJson = rawResponse.replace(/```json/g, "").replace(/```/g, "").trim();
            analysis = JSON.parse(cleanJson);
        }
        catch (e) {
            logger_1.default.error("Failed to parse AI response", { rawResponse });
            return res.status(500).json({ success: false, error: "AI Analysis failed to generate valid format" });
        }
        // Update Citation
        const updatedCitation = await prisma_1.prisma.citation.update({
            where: { id: citationId },
            data: {
                themes: analysis.themes || [],
                matrix_notes: analysis.matrix_notes || ""
            }
        });
        return res.status(200).json({
            success: true,
            data: updatedCitation
        });
    }
    catch (error) {
        logger_1.default.error("Error analyzing citation", {
            error: error.message,
            stack: error.stack,
        });
        return res.status(500).json({
            success: false,
            error: error.message || "Failed to analyze citation",
        });
    }
});
exports.default = router;
