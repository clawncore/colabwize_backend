import axios from "axios";
import logger from "../monitoring/logger";
import { AcademicPaper } from "./semanticScholarService";
import { SecretsService } from "./secrets-service";

export class IEEEService {
    /**
     * Search for papers using IEEE Xplore
     */
    static async searchPapers(query: string, limit: number = 5): Promise<AcademicPaper[]> {
        try {
            const apiKey = await SecretsService.getSecret("IEEE_API_KEY");
            if (!apiKey) return [];

            const response = await axios.get("https://ieeexploreapi.ieee.org/api/v1/search/articles", {
                params: {
                    querytext: query,
                    max_records: limit,
                    apikey: apiKey,
                    format: "json"
                },
                timeout: 10000,
            });

            if (!response.data || !response.data.articles) {
                return [];
            }

            return response.data.articles.map((article: any) => this.mapToAcademicPaper(article));

        } catch (error: any) {
            logger.error("IEEE search failed", { error: error.message, query });
            return [];
        }
    }

    private static mapToAcademicPaper(article: any): AcademicPaper {
        const authors = article.authors?.authors?.map((a: any) => a.full_name) || [];

        return {
            id: article.article_number || article.doi,
            title: article.title,
            authors: authors.slice(0, 5),
            year: parseInt(article.publication_year) || new Date().getFullYear(),
            abstract: article.abstract,
            url: article.html_url || article.pdf_url,
            citationCount: article.citing_paper_count || 0,
            venue: article.publication_title,
            source: "ieee"
        };
    }
}
