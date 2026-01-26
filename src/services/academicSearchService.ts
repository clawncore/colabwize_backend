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
     * Universal search for academic papers across multiple databases
     */
    static async searchPapers(query: string, limit: number = 8): Promise<AcademicPaper[]> {
        try {
            logger.info("Starting multi-source academic search", { query });

            // Run searches in parallel for efficiency
            const searchPromises = [
                SemanticScholarService.searchPapers(query, 5),
                OpenAlexService.searchPapers(query, 5),
                ArxivService.searchPapers(query, 5),
                PubmedService.searchPapers(query, 5),
                IEEEService.searchPapers(query, 5),
                DOAJService.searchPapers(query, 5),
                CrossRefService.searchPapers(query, 5)
            ];

            const results = await Promise.allSettled(searchPromises);

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
