import axios from "axios";
import logger from "../monitoring/logger";
import { AcademicPaper } from "./semanticScholarService";

export class CrossRefService {
    /**
     * Search for papers using CrossRef
     */
    static async searchPapers(query: string, limit: number = 5): Promise<AcademicPaper[]> {
        try {
            const response = await axios.get("https://api.crossref.org/works", {
                params: {
                    query: query,
                    rows: limit,
                    select: "title,author,abstract,DOI,published,created,container-title",
                },
                headers: { "User-Agent": "ColabWize/1.0 (mailto:support@colabwize.com)" }, // Polite pool
                timeout: 10000,
            });

            if (!response.data || !response.data.message || !response.data.message.items) {
                return [];
            }

            return response.data.message.items.map((item: any) => this.mapToAcademicPaper(item));

        } catch (error: any) {
            logger.error("CrossRef search failed", { error: error.message, query });
            return [];
        }
    }

    private static mapToAcademicPaper(item: any): AcademicPaper {
        const title = Array.isArray(item.title) ? item.title[0] || "" : item.title || "";
        const authors = Array.isArray(item.author)
            ? item.author.map((auth: any) => `${auth.given || ""} ${auth.family || ""}`.trim())
            : [];

        const year = item.published?.["date-parts"]?.[0]?.[0] ||
            item.created?.["date-parts"]?.[0]?.[0] ||
            new Date().getFullYear();

        return {
            id: item.DOI,
            title: title,
            authors: authors.slice(0, 5),
            year: year,
            abstract: item.abstract?.replace(/<[^>]*>?/gm, "") || undefined, // Strip JATS XML tags if present
            url: `https://doi.org/${item.DOI}`,
            citationCount: 0, // CrossRef doesn't provide this in the simple works query usually
            venue: Array.isArray(item["container-title"]) ? item["container-title"][0] : item["container-title"],
            source: "crossref"
        };
    }
}
