import axios from "axios";
import logger from "../monitoring/logger";
import { AcademicPaper } from "./semanticScholarService"; // Sharing interface
import { SecretsService } from "./secrets-service";

export class OpenAlexService {
    private static readonly API_URL = "https://api.openalex.org/works";

    /**
     * Search for papers using OpenAlex
     */
    static async searchPapers(query: string, limit: number = 5): Promise<AcademicPaper[]> {
        try {
            // OpenAlex requests "mailto" for polite pool
            const contactEmail = await SecretsService.getContactAdminEmail();

            const response = await axios.get(this.API_URL, {
                params: {
                    search: query,
                    per_page: limit,
                    mailto: contactEmail || "support@colabwize.com"
                }
            });

            if (!response.data || !response.data.results) {
                return [];
            }

            return response.data.results.map((work: any) => this.mapToAcademicPaper(work));

        } catch (error: any) {
            logger.error("OpenAlex search failed", { error: error.message, query });
            throw error;
        }
    }

    private static mapToAcademicPaper(work: any): AcademicPaper {
        return {
            id: work.id.replace("https://openalex.org/", ""),
            title: work.title,
            authors: work.authorships?.map((a: any) => a.author.display_name) || [],
            year: work.publication_year,
            abstract: this.reconstructAbstract(work.abstract_inverted_index),
            url: (work.open_access?.is_oa && work.open_access.oa_url) ? work.open_access.oa_url : (work.doi || work.id),
            citationCount: work.cited_by_count || 0,
            openAccessPdf: work.open_access?.is_oa ? work.open_access.oa_url : undefined,
            venue: work.primary_location?.source?.display_name,
            source: "openalex"
        };
    }

    /**
     * Reconstruct abstract from OpenAlex's inverted index
     */
    private static reconstructAbstract(invertedIndex: Record<string, number[]> | null | undefined): string | undefined {
        if (!invertedIndex) return undefined;

        try {
            // Create an array to hold words at their respective positions
            const wordMap: Record<number, string> = {};
            let maxIndex = 0;

            // Iterate over the inverted index
            Object.entries(invertedIndex).forEach(([word, positions]) => {
                positions.forEach((pos) => {
                    wordMap[pos] = word;
                    if (pos > maxIndex) maxIndex = pos;
                });
            });

            // Reconstruct the string
            const words: string[] = [];
            for (let i = 0; i <= maxIndex; i++) {
                if (wordMap[i]) {
                    words.push(wordMap[i]);
                }
            }

            return words.join(" ");
        } catch (error) {
            logger.warn("Failed to reconstruct abstract from inverted index", { error });
            return undefined;
        }
    }
}
