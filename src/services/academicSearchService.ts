import { SemanticScholarService, AcademicPaper } from "./semanticScholarService";
import { OpenAlexService } from "./openAlexService";
import logger from "../monitoring/logger";

export class AcademicSearchService {

    /**
     * Universal search for academic papers with fallback strategy
     * Primary: Semantic Scholar
     * Fallback: OpenAlex
     */
    static async searchPapers(query: string, limit: number = 5): Promise<AcademicPaper[]> {
        try {
            // 1. Try Semantic Scholar
            logger.info("Searching Semantic Scholar", { query });
            const results = await SemanticScholarService.searchPapers(query, limit);

            if (results.length > 0) {
                return results;
            }

            logger.info("Semantic Scholar returned no results, trying OpenAlex...");
        } catch (error) {
            logger.warn("Semantic Scholar search failed, trying OpenAlex fallback", { error });
        }

        // 2. Fallback to OpenAlex
        try {
            logger.info("Searching OpenAlex (Fallback)", { query });
            return await OpenAlexService.searchPapers(query, limit);
        } catch (error) {
            logger.error("All academic search providers failed", { error });
            return [];
        }
    }

    /**
     * "Legitimize" a claim: Find a real paper that supports a statement.
     * This is the "Citation Armor" core function.
     */
    static async findEvidenceForClaim(claim: string): Promise<AcademicPaper[]> {
        // Basic NLP preprocessing could go here (remove stopwords, focus on nouns/verbs)
        // For now, passing the full claim works reasonably well with modern semantic search APIs
        return this.searchPapers(claim, 3);
    }
}
