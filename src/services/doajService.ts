import axios from "axios";
import logger from "../monitoring/logger";
import { AcademicPaper } from "./semanticScholarService";

export class DOAJService {
    /**
     * Search for papers using DOAJ
     */
    static async searchPapers(query: string, limit: number = 5): Promise<AcademicPaper[]> {
        try {
            const response = await axios.get(`https://doaj.org/api/v2/search/articles/${encodeURIComponent(query)}`, {
                params: {
                    pageSize: limit,
                },
                timeout: 10000,
            });

            if (!response.data || !response.data.results) {
                return [];
            }

            return response.data.results.map((item: any) => this.mapToAcademicPaper(item));

        } catch (error: any) {
            logger.error("DOAJ search failed", { error: error.message, query });
            return [];
        }
    }

    private static mapToAcademicPaper(item: any): AcademicPaper {
        const bibjson = item.bibjson || {};
        const authors = bibjson.author?.map((a: any) => a.name) || [];

        return {
            id: item.id,
            title: bibjson.title,
            authors: authors.slice(0, 5),
            year: parseInt(bibjson.year) || new Date().getFullYear(),
            abstract: bibjson.abstract,
            url: bibjson.link?.[0]?.content || `https://doaj.org/article/${item.id}`,
            citationCount: 0,
            venue: bibjson.journal?.title,
            source: "doaj"
        };
    }
}
