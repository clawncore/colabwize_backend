"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IEEEService = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = __importDefault(require("../monitoring/logger"));
const secrets_service_1 = require("./secrets-service");
class IEEEService {
    /**
     * Search for papers using IEEE Xplore
     */
    static async searchPapers(query, limit = 5) {
        try {
            const apiKey = await secrets_service_1.SecretsService.getSecret("IEEE_API_KEY");
            if (!apiKey)
                return [];
            const response = await axios_1.default.get("https://ieeexploreapi.ieee.org/api/v1/search/articles", {
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
            return response.data.articles.map((article) => this.mapToAcademicPaper(article));
        }
        catch (error) {
            logger_1.default.error("IEEE search failed", { error: error.message, query });
            return [];
        }
    }
    static mapToAcademicPaper(article) {
        const authors = article.authors?.authors?.map((a) => a.full_name) || [];
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
exports.IEEEService = IEEEService;
