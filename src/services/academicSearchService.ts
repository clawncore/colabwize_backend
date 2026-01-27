import { SemanticScholarService, AcademicPaper } from "./semanticScholarService";
import { OpenAlexService } from "./openAlexService";
import { ArxivService } from "./arxivService";
import { PubmedService } from "./pubmedService";
import { IEEEService } from "./ieeeService";
import { DOAJService } from "./doajService";
import { CrossRefService } from "./crossRefService";
import logger from "../monitoring/logger";

export class AcademicSearchService {

    /**
     * Search papers across multiple databases and aggregate results
     */
    static async searchPapers(query: string, limit: number = 50): Promise<AcademicPaper[]> {
        try {
            // Search across all providers in parallel
            const results = await Promise.allSettled([
                SemanticScholarService.searchPapers(query, 10),
                OpenAlexService.searchPapers(query, 10),
                ArxivService.searchPapers(query, 10),
                PubmedService.searchPapers(query, 10),
                IEEEService.searchPapers(query, 10),
                DOAJService.searchPapers(query, 10),
                CrossRefService.searchPapers(query, 10)
            ]);

            const allPapers: AcademicPaper[] = [];
            results.forEach((result, index) => {
                if (result.status === "fulfilled") {
                    allPapers.push(...result.value);
                } else {
                    logger.warn(`Search provider ${index} failed`, { error: result.reason });
                }
            });

            // Deduplicate and rank
            return this.deduplicateAndRank(allPapers, limit);

        } catch (error: any) {
            logger.error("Academic search aggregation failed", { error: error.message });
            return [];
        }
    }

    private static deduplicateAndRank(papers: AcademicPaper[], limit: number): AcademicPaper[] {
        const uniquePapers: AcademicPaper[] = [];
        const seenTitles = new Set<string>();

        // Sort by quality/citation count where available
        const sorted = [...papers].sort((a, b) => (b.citationCount || 0) - (a.citationCount || 0));

        for (const paper of sorted) {
            const normalizedTitle = paper.title.toLowerCase().trim().replace(/[^\w\s]/g, "");

            // Check for near-duplicates (simple subset check for titles)
            let isDuplicate = false;
            if (seenTitles.has(normalizedTitle)) {
                isDuplicate = true;
            } else {
                for (const existing of seenTitles) {
                    if (normalizedTitle.includes(existing) || existing.includes(normalizedTitle)) {
                        isDuplicate = true;
                        break;
                    }
                }
            }

            if (!isDuplicate) {
                uniquePapers.push(paper);
                seenTitles.add(normalizedTitle);
            }

            if (uniquePapers.length >= limit) break;
        }

        return uniquePapers;
    }

    /**
     * "Legitimize" a claim: Find a real paper that supports a statement.
     */
    static async findEvidenceForClaim(claim: string): Promise<AcademicPaper[]> {
        return this.searchPapers(claim, 5);
    }
}
