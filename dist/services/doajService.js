"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DOAJService = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = __importDefault(require("../monitoring/logger"));
class DOAJService {
    /**
     * Search for papers using DOAJ
     */
    static async searchPapers(query, limit = 5) {
        try {
            const response = await axios_1.default.get(`https://doaj.org/api/v2/search/articles/${encodeURIComponent(query)}`, {
                params: {
                    pageSize: limit,
                },
                timeout: 10000,
            });
            if (!response.data || !response.data.results) {
                return [];
            }
            return response.data.results.map((item) => this.mapToAcademicPaper(item));
        }
        catch (error) {
            logger_1.default.error("DOAJ search failed", { error: error.message, query });
            return [];
        }
    }
    static mapToAcademicPaper(item) {
        const bibjson = item.bibjson || {};
        const authors = bibjson.author?.map((a) => a.name) || [];
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
exports.DOAJService = DOAJService;
