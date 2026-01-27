import { initializePrisma } from "../lib/prisma-async";
import logger from "../monitoring/logger";
import { OpenAIService } from "./openaiService";

interface ResearchGap {
    type: "temporal" | "topical" | "methodological";
    title: string;
    description: string;
    severity: "high" | "medium" | "low";
    suggestedKeywords: string[];
    relatedCitations: string[];
}

export class ResearchGapService {
    /**
     * Analyze citations and document content to identify research gaps using AI
     */
    static async analyzeGaps(projectId: string): Promise<ResearchGap[]> {
        try {
            const prisma = await initializePrisma();

            // Fetch project with citations
            const project = await prisma.project.findUnique({
                where: { id: projectId },
                include: {
                    citations: true
                }
            });

            if (!project || !project.citations || project.citations.length === 0) {
                return [];
            }

            // Prepare bibliographic context for AI
            const bibliography = project.citations.map(c => ({
                title: c.title,
                author: c.author,
                year: c.year,
                abstract: (c.abstract || "").slice(0, 500) // Truncated to save tokens
            }));

            const projectContext = {
                title: project.title,
                description: project.description
            };

            const prompt = `
Analyze the following research project and its current bibliography to identify 3-5 potential "Research Gaps".
Research Gaps are underexplored areas, missing perspectives, or methodological limitations in the current literature set.

Project Context:
Title: ${projectContext.title}
Description: ${projectContext.description}

Bibliography (First ${bibliography.length} sources):
${JSON.stringify(bibliography, null, 2)}

Identify gaps in these categories:
1. "temporal": Recently emerged aspects not covered by older citations.
2. "topical": Specific sub-topics or variables that are mentioned but not deeply explored.
3. "methodological": Missing research approaches (e.g., if all sources are meta-analyses, a "primary case study" might be a gap).

Return ONLY a valid JSON array of objects in this exact format:
[
  {
    "type": "temporal" | "topical" | "methodological",
    "title": "Short descriptive title",
    "description": "Clear 1-2 sentence explanation of the gap found",
    "severity": "high" | "medium" | "low",
    "suggestedKeywords": ["keyword1", "keyword2", "keyword3"],
    "relatedCitations": ["original_source_title_1", "original_source_title_2"]
  }
]
`;

            const rawResponse = await OpenAIService.generateCompletion(prompt, {
                temperature: 0.4,
                maxTokens: 1500
            });

            let gaps: ResearchGap[] = [];
            try {
                const cleanJson = rawResponse.replace(/```json/g, "").replace(/```/g, "").trim();
                gaps = JSON.parse(cleanJson);
            } catch (e) {
                logger.error("Failed to parse AI research gaps response", { rawResponse });
                // Fallback to minimal heuristic if AI fails entirely
                return [];
            }

            // Map relatedCitations titles back to IDs if possible
            const mappedGaps = gaps.map(gap => ({
                ...gap,
                relatedCitations: gap.relatedCitations.map(title => {
                    const match = project.citations.find(c => c.title === title);
                    return match ? match.id : title;
                })
            }));

            logger.info("Research gap AI analysis completed", {
                projectId,
                gapsFound: mappedGaps.length
            });

            return mappedGaps;

        } catch (error: any) {
            logger.error("Failed to analyze research gaps with AI", {
                projectId,
                error: error.message
            });
            throw error;
        }
    }
}
