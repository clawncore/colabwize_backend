"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SemanticScholarService = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = __importDefault(require("../monitoring/logger"));
const secrets_service_1 = require("./secrets-service");
class SemanticScholarService {
    static API_URL = "https://api.semanticscholar.org/graph/v1";
    // Rate Limiting: 1 request per second
    static lastRequestTime = 0;
    static RATE_LIMIT_MS = 1000;
    static requestQueue = Promise.resolve();
    /**
     * Enforce rate limit sequentially using a promise queue.
     */
    static async waitForRateLimit() {
        this.requestQueue = this.requestQueue.then(async () => {
            const now = Date.now();
            const timeSinceLast = now - this.lastRequestTime;
            if (timeSinceLast < this.RATE_LIMIT_MS) {
                await new Promise((resolve) => setTimeout(resolve, this.RATE_LIMIT_MS - timeSinceLast));
            }
            this.lastRequestTime = Date.now();
        });
        return this.requestQueue;
    }
    /**
     * Search for papers by query (e.g., specific claim or topic)
     */
    static async searchPapers(query, limit = 5) {
        try {
            const apiKey = await secrets_service_1.SecretsService.getSemanticScholarApiKey();
            const headers = {};
            if (apiKey) {
                headers["x-api-key"] = apiKey;
            }
            // Fields to retrieve
            const fields = "paperId,title,authors,year,abstract,url,citationCount,isOpenAccess,openAccessPdf,venue";
            await this.waitForRateLimit();
            const response = await axios_1.default.get(`${this.API_URL}/paper/search`, {
                params: {
                    query,
                    limit,
                    fields,
                },
                headers,
            });
            if (!response.data || !response.data.data) {
                return [];
            }
            return response.data.data.map((paper) => this.mapToAcademicPaper(paper));
        }
        catch (error) {
            logger_1.default.error("Semantic Scholar search failed", {
                error: error.message,
                query,
            });
            throw error;
        }
    }
    /**
     * Get paper details by DOI
     */
    static async getPaperByDoi(doi) {
        try {
            const apiKey = await secrets_service_1.SecretsService.getSemanticScholarApiKey();
            const headers = {};
            if (apiKey) {
                headers["x-api-key"] = apiKey;
            }
            const fields = "paperId,title,authors,year,abstract,url,citationCount,isOpenAccess,openAccessPdf,venue";
            await this.waitForRateLimit();
            const response = await axios_1.default.get(`${this.API_URL}/paper/DOI:${doi}`, {
                params: { fields },
                headers,
            });
            if (!response.data)
                return null;
            return this.mapToAcademicPaper(response.data);
        }
        catch (error) {
            if (error.response?.status === 404)
                return null;
            logger_1.default.error("Semantic Scholar DOI lookup failed", {
                error: error.message,
                doi,
            });
            throw error;
        }
    }
    static mapToAcademicPaper(raw) {
        return {
            id: raw.paperId,
            title: raw.title,
            authors: raw.authors?.map((a) => a.name) || [],
            year: raw.year || new Date().getFullYear(),
            abstract: raw.abstract,
            url: raw.url || `https://www.semanticscholar.org/paper/${raw.paperId}`,
            citationCount: raw.citationCount || 0,
            openAccessPdf: raw.openAccessPdf?.url,
            venue: raw.venue,
            source: "semantic_scholar",
        };
    }
}
exports.SemanticScholarService = SemanticScholarService;
