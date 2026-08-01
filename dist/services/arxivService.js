"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArxivService = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = __importDefault(require("../monitoring/logger"));
class ArxivService {
    /**
     * Search for papers using arXiv
     */
    static async searchPapers(query, limit = 5) {
        try {
            const response = await axios_1.default.get(`http://export.arxiv.org/api/query`, {
                params: {
                    search_query: `ti:"${query}" OR abs:"${query}"`,
                    max_results: limit,
                },
                timeout: 25000, // ArXiv can be slow; give it 25s
            });
            const xmlText = response.data;
            const entries = xmlText.match(/<entry>[\s\S]*?<\/entry>/g) || [];
            return entries.map((entry) => this.mapToAcademicPaper(entry));
        }
        catch (error) {
            logger_1.default.error("ArXiv search failed", { error: error.message, query });
            return [];
        }
    }
    static mapToAcademicPaper(entry) {
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
            id: id.split("/").pop() || id,
            externalId: id.split("/").pop() || id, // Required by aggregator in paperDiscoveryService
            title: title.replace(/\n/g, " "),
            authors: authors.slice(0, 5),
            year: year,
            abstract: abstract.replace(/\n/g, " "),
            url: id,
            citationCount: 0,
            source: "arxiv",
        };
    }
}
exports.ArxivService = ArxivService;
