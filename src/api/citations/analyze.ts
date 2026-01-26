
import express, { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import logger from "../../monitoring/logger";
import { OpenAIService } from "../../services/openaiService";

const router = express.Router();

/**
 * POST /api/citations/:projectId/:citationId/analyze
 * AI Analysis of citation for Literature Matrix
 */
router.post(
    "/:projectId/:citationId/analyze",
    async (req: Request, res: Response) => {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    error: "Authentication required",
                });
            }

            const { projectId, citationId } = req.params;

            const citation = await prisma.citation.findUnique({
                where: { id: citationId },
                select: { id: true, abstract: true, title: true }
            });

            if (!citation) {
                return res.status(404).json({ success: false, error: "Citation not found" });
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
            const rawResponse = await OpenAIService.generateCompletion(prompt, {
                temperature: 0.3, // Low temperature for deterministic output
                maxTokens: 500
            });

            // Parse JSON
            let analysis: { themes: string[], matrix_notes: string };
            try {
                // Remove markdown code blocks if present
                const cleanJson = rawResponse.replace(/```json/g, "").replace(/```/g, "").trim();
                analysis = JSON.parse(cleanJson);
            } catch (e) {
                logger.error("Failed to parse AI response", { rawResponse });
                return res.status(500).json({ success: false, error: "AI Analysis failed to generate valid format" });
            }

            // Update Citation
            const updatedCitation = await prisma.citation.update({
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

        } catch (error: any) {
            logger.error("Error analyzing citation", {
                error: error.message,
                stack: error.stack,
            });

            return res.status(500).json({
                success: false,
                error: error.message || "Failed to analyze citation",
            });
        }
    }
);

export default router;
