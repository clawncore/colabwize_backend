"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CrossRefService = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = __importDefault(require("../monitoring/logger"));
class CrossRefService {
    /**
     * Search for papers using CrossRef
     */
    static async searchPapers(query, limit = 5) {
        try {
            const response = await axios_1.default.get("https://api.crossref.org/works", {
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
            return response.data.message.items.map((item) => this.mapToAcademicPaper(item));
        }
        catch (error) {
            logger_1.default.error("CrossRef search failed", { error: error.message, query });
            return [];
        }
    }
    static mapToAcademicPaper(item) {
        const title = Array.isArray(item.title) ? item.title[0] || "" : item.title || "";
        const authors = Array.isArray(item.author)
            ? item.author.map((auth) => `${auth.given || ""} ${auth.family || ""}`.trim())
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
    /**
     * Fetch a single work by DOI
     */
    static async getWorkByDOI(doi) {
        try {
            const response = await axios_1.default.get(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
                headers: { "User-Agent": "ColabWize/1.0 (mailto:support@colabwize.com)" },
                timeout: 10000,
            });
            if (response.data && response.data.message) {
                return this.mapToAcademicPaper(response.data.message);
            }
            return null;
        }
        catch (error) {
            logger_1.default.error("CrossRef DOI lookup failed", { error: error.message, doi });
            return null;
        }
    }
}
exports.CrossRefService = CrossRefService;
