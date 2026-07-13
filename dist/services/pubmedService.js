"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PubmedService = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = __importDefault(require("../monitoring/logger"));
class PubmedService {
    /**
     * Search for papers using PubMed
     */
    static async searchPapers(query, limit = 5) {
        try {
            // 1. Search for IDs
            const searchResponse = await axios_1.default.get("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi", {
                params: {
                    db: "pubmed",
                    term: query,
                    retmax: limit,
                    retmode: "json",
                },
                timeout: 10000,
            });
            const ids = searchResponse.data?.esearchresult?.idlist || [];
            if (ids.length === 0)
                return [];
            // 2. Fetch details
            const fetchResponse = await axios_1.default.get("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi", {
                params: {
                    db: "pubmed",
                    id: ids.join(","),
                    retmode: "xml",
                },
                timeout: 10000,
            });
            const xmlText = fetchResponse.data;
            const entries = xmlText.match(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/g) || [];
            return entries.map((entry) => this.mapToAcademicPaper(entry));
        }
        catch (error) {
            logger_1.default.error("PubMed search failed", { error: error.message, query });
            return [];
        }
    }
    static mapToAcademicPaper(entry) {
        const title = entry.match(/<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/)?.[1]?.trim() || "";
        const abstract = entry.match(/<AbstractText>([\s\S]*?)<\/AbstractText>/)?.[1]?.trim() || "";
        const pmid = entry.match(/<PMID[^>]*>([\s\S]*?)<\/PMID>/)?.[1]?.trim() || "";
        const yearMatch = entry.match(/<Year>(\d{4})<\/Year>/);
        const year = yearMatch ? parseInt(yearMatch[1]) : new Date().getFullYear();
        const journalMatch = entry.match(/<Title>([\s\S]*?)<\/Title>/);
        const venue = journalMatch ? journalMatch[1].trim() : undefined;
        // Extract authors
        const authorMatches = entry.matchAll(/<LastName>([\s\S]*?)<\/LastName>[\s\S]*?<ForeName>([\s\S]*?)<\/ForeName>/g);
        const authors = Array.from(authorMatches, (match) => `${match[2]} ${match[1]}`);
        return {
            id: pmid,
            title: title.replace(/<[^>]*>?/gm, ""),
            authors: authors.slice(0, 5),
            year: year,
            abstract: abstract.replace(/<[^>]*>?/gm, ""),
            url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
            citationCount: 0,
            venue: venue,
            source: "pubmed"
        };
    }
}
exports.PubmedService = PubmedService;
