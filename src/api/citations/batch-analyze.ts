import express, { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import logger from "../../monitoring/logger";
import { OpenAIService } from "../../services/openaiService";

const router = express.Router();

/**
 * POST /api/citations/:projectId/batch-analyze
 * Batch AI Analysis of all project citations for Literature Matrix
 */
router.post(
    "/:projectId/batch-analyze",
    async (req: Request, res: Response) => {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    error: "Authentication required",
                });
            }

            const { projectId } = req.params;
            const { force = false } = req.body;

            // 1. Fetch citations with abstracts
            const citations = await prisma.citation.findMany({
                where: {
                    project_id: projectId,
                    abstract: { not: null },
                    // If not forcing, only analyze those missing data
                    ...(force ? {} : {
                        OR: [
                            { themes: { equals: prisma.jsonNull } },
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

            logger.info(`Starting batch analysis for ${citations.length} citations`, { projectId, userId });

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
"${citation.abstract!.slice(0, 3000)}"

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

                    const rawResponse = await OpenAIService.generateCompletion(prompt, {
                        temperature: 0.3,
                        maxTokens: 500
                    });

                    let analysis: { themes: string[], matrix_notes: string };
                    try {
                        const cleanJson = rawResponse.replace(/```json/g, "").replace(/```/g, "").trim();
                        analysis = JSON.parse(cleanJson);
                    } catch (e) {
                        logger.error(`Failed to parse AI response for citation ${citation.id}`, { rawResponse });
                        continue; // Skip this one
                    }

                    const updated = await prisma.citation.update({
                        where: { id: citation.id },
                        data: {
                            themes: analysis.themes || [],
                            matrix_notes: analysis.matrix_notes || ""
                        }
                    });

                    updatedCitations.push(updated);
                } catch (err: any) {
                    logger.error(`Error analyzing individual citation ${citation.id}`, { error: err.message });
                }
            }

            return res.status(200).json({
                success: true,
                message: `Analyzed ${updatedCitations.length} citations`,
                data: updatedCitations
            });

        } catch (error: any) {
            logger.error("Error in batch analysis", {
                error: error.message,
                stack: error.stack,
            });

            return res.status(500).json({
                success: false,
                error: error.message || "Batch analysis failed",
            });
        }
    }
);

export default router;
