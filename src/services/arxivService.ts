import axios from "axios";
import logger from "../monitoring/logger";
import { AcademicPaper } from "./semanticScholarService";

export class ArxivService {
    /**
     * Search for papers using arXiv
     */
    static async searchPapers(query: string, limit: number = 5): Promise<AcademicPaper[]> {
        try {
            const response = await axios.get(`http://export.arxiv.org/api/query`, {
                params: {
                    search_query: `ti:"${query}" OR abs:"${query}"`,
                    max_results: limit,
                },
                timeout: 10000,
            });

            const xmlText = response.data;
            const entries = xmlText.match(/<entry>[\s\S]*?<\/entry>/g) || [];

            return entries.map((entry: string) => this.mapToAcademicPaper(entry));

        } catch (error: any) {
            logger.error("ArXiv search failed", { error: error.message, query });
            return [];
        }
    }

    private static mapToAcademicPaper(entry: string): AcademicPaper {
        const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() || "";
        const abstract = entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.trim() || "";
        const id = entry.match(/<id>([\s\S]*?)<\/id>/)?.[1]?.trim() || "";

        // Extract authors
        const authorMatches = entry.matchAll(/<name>(.*?)<\/name>/g);
        const authors = Array.from(authorMatches, (match) => match[1]);

        // ArXiv ID contains year info (e.g., 2107.12345 -> 2021)
        let year = new Date().getFullYear();
        const arxivIdMatch = id.match(/\/(\d{2})(\d{2})\./);
        if (arxivIdMatch) {
            const yearPrefix = parseInt(arxivIdMatch[1]);
            year = yearPrefix >= 90 ? 1900 + yearPrefix : 2000 + yearPrefix;
        }

        return {
            id: id.split('/').pop() || id,
            title: title.replace(/\n/g, " "),
            authors: authors.slice(0, 5),
            year: year,
            abstract: abstract.replace(/\n/g, " "),
            url: id,
            citationCount: 0,
            source: "arxiv"
        };
    }
}
