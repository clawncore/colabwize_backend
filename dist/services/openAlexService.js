"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAlexService = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = __importDefault(require("../monitoring/logger"));
const secrets_service_1 = require("./secrets-service");
class OpenAlexService {
    static API_URL = "https://api.openalex.org/works";
    /**
     * Search for papers using OpenAlex
     */
    static async searchPapers(query, limit = 5) {
        try {
            // OpenAlex requests "mailto" for polite pool
            const contactEmail = await secrets_service_1.SecretsService.getContactAdminEmail();
            const response = await axios_1.default.get(this.API_URL, {
                params: {
                    search: query,
                    per_page: limit,
                    mailto: contactEmail || "support@colabwize.com"
                }
            });
            if (!response.data || !response.data.results) {
                return [];
            }
            return response.data.results.map((work) => this.mapToAcademicPaper(work));
        }
        catch (error) {
            logger_1.default.error("OpenAlex search failed", { error: error.message, query });
            throw error;
        }
    }
    static mapToAcademicPaper(work) {
        return {
            id: work.id.replace("https://openalex.org/", ""),
            title: work.title,
            authors: work.authorships?.map((a) => a.author.display_name) || [],
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
    static reconstructAbstract(invertedIndex) {
        if (!invertedIndex)
            return undefined;
        try {
            // Create an array to hold words at their respective positions
            const wordMap = {};
            let maxIndex = 0;
            // Iterate over the inverted index
            Object.entries(invertedIndex).forEach(([word, positions]) => {
                positions.forEach((pos) => {
                    wordMap[pos] = word;
                    if (pos > maxIndex)
                        maxIndex = pos;
                });
            });
            // Reconstruct the string
            const words = [];
            for (let i = 0; i <= maxIndex; i++) {
                if (wordMap[i]) {
                    words.push(wordMap[i]);
                }
            }
            return words.join(" ");
        }
        catch (error) {
            logger_1.default.warn("Failed to reconstruct abstract from inverted index", { error });
            return undefined;
        }
    }
}
exports.OpenAlexService = OpenAlexService;
