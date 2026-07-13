"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaperRecommendationService = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = __importDefault(require("../monitoring/logger"));
const paperDiscoveryService_1 = require("./paperDiscoveryService");
class PaperRecommendationService {
    static CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
    static cache = new Map();
    /**
     * Search papers for a given topic/query
     */
    static async searchPapers(query, options = {}) {
        try {
            const cacheKey = `search:${query}:${JSON.stringify(options)}`;
            const cached = this.getFromCache(cacheKey);
            if (cached) {
                logger_1.default.info("Returning cached paper search results");
                return cached;
            }
            // Use existing PaperDiscoveryService
            const papers = await paperDiscoveryService_1.PaperDiscoveryService.searchPapers(query, options.maxResults || 10);
            // Apply filters
            let filtered = papers;
            if (options.minCitationCount) {
                filtered = filtered.filter((p) => (p.citationCount || 0) >= options.minCitationCount);
            }
            if (options.yearRange) {
                filtered = filtered.filter((p) => p.year >= options.yearRange.start &&
                    p.year <= options.yearRange.end);
            }
            if (options.excludePaperIds && options.excludePaperIds.length > 0) {
                filtered = filtered.filter((p) => !options.excludePaperIds.includes(p.paperId));
            }
            // Convert to our Paper interface
            const result = filtered.map((p) => ({
                paperId: p.paperId,
                title: p.title,
                authors: p.authors || [],
                year: p.year || 0,
                abstract: p.abstract,
                citationCount: p.citationCount || 0,
                url: p.url,
                doi: p.doi,
                venue: p.venue,
                fieldsOfStudy: p.fieldsOfStudy,
            }));
            this.setCache(cacheKey, result);
            return result;
        }
        catch (error) {
            logger_1.default.error("Error searching papers:", error);
            throw new Error(`Paper search failed: ${error.message}`);
        }
    }
    /**
     * Get related papers based on a paper ID
     */
    static async getRelatedPapers(paperId, limit = 10) {
        try {
            const cacheKey = `related:${paperId}:${limit}`;
            const cached = this.getFromCache(cacheKey);
            if (cached) {
                return cached;
            }
            const url = `https://api.openalex.org/works?filter=ids:${paperId}&select=title,authors,year,abstract,citation_count,url,doi,venue,fields_of_study&limit=${limit}`;
            const response = await axios_1.default.get(url, {
                params: {
                    fields: "title,authors,year,abstract,citationCount,url,doi,venue,fieldsOfStudy",
                    limit,
                },
                timeout: 10000,
            });
            const papers = response.data.data.map((ref) => ({
                paperId: ref.citedPaper.paperId,
                title: ref.citedPaper.title,
                authors: ref.citedPaper.authors || [],
                year: ref.citedPaper.year || 0,
                abstract: ref.citedPaper.abstract,
                citationCount: ref.citedPaper.citationCount || 0,
                url: ref.citedPaper.url,
                doi: ref.citedPaper.doi,
                venue: ref.citedPaper.venue,
                fieldsOfStudy: ref.citedPaper.fieldsOfStudy,
            }));
            this.setCache(cacheKey, papers);
            return papers;
        }
        catch (error) {
            logger_1.default.error("Error getting related papers:", error);
            return []; // Return empty array on error
        }
    }
    /**
     * Get paper details by ID
     */
    static async getPaperDetails(paperId) {
        try {
            const cacheKey = `details:${paperId}`;
            const cached = this.getFromCache(cacheKey);
            if (cached) {
                return cached;
            }
            const paper = await paperDiscoveryService_1.PaperDiscoveryService.getPaperDetails(paperId);
            if (!paper) {
                return null;
            }
            const result = {
                paperId: paper.paperId ?? "",
                title: paper.title,
                authors: paper.authors || [],
                year: paper.year ?? 0,
                abstract: paper.abstract ?? undefined,
                citationCount: paper.citationCount ?? 0,
                url: paper.url ?? undefined,
                doi: paper.doi ?? undefined,
                venue: paper.venue ?? undefined,
                fieldsOfStudy: paper.fieldsOfStudy ?? undefined,
            };
            this.setCache(cacheKey, result);
            return result;
        }
        catch (error) {
            logger_1.default.error("Error getting paper details:", error);
            return null;
        }
    }
    /**
     * Recommend papers for a specific section of text
     */
    static async recommendForSection(sectionText, existingCitations, options = {}) {
        try {
            // Extract keywords from section text
            const keywords = this.extractKeywords(sectionText);
            const query = keywords.slice(0, 5).join(" ");
            // Search for papers
            const papers = await this.searchPapers(query, {
                ...options,
                excludePaperIds: existingCitations,
            });
            // Score and rank papers by relevance
            const scored = papers.map((paper) => ({
                paper,
                score: this.calculateRelevanceScore(paper, sectionText, keywords),
            }));
            // Sort by score and return
            scored.sort((a, b) => b.score - a.score);
            return scored.map((s) => s.paper);
        }
        catch (error) {
            logger_1.default.error("Error recommending papers for section:", error);
            return [];
        }
    }
    /**
     * Check if a citation is relevant to given text
     */
    static checkCitationRelevance(text, citation) {
        try {
            const textKeywords = this.extractKeywords(text);
            const paperKeywords = this.extractKeywords(`${citation.title} ${citation.abstract || ""}`);
            // Calculate keyword overlap
            const overlap = textKeywords.filter((kw) => paperKeywords.includes(kw));
            const score = overlap.length / Math.max(textKeywords.length, 1);
            let reason = "";
            if (score > 0.3) {
                reason = `Strong keyword overlap: ${overlap.slice(0, 3).join(", ")}`;
            }
            else if (score > 0.1) {
                reason = `Moderate relevance based on topic similarity`;
            }
            else {
                reason = `Low relevance - consider more specific citations`;
            }
            return {
                isRelevant: score > 0.1,
                score,
                reason,
            };
        }
        catch (error) {
            logger_1.default.error("Error checking citation relevance:", error);
            return {
                isRelevant: false,
                score: 0,
                reason: "Error checking relevance",
            };
        }
    }
    /**
     * Extract keywords from text
     */
    static extractKeywords(text) {
        // Simple keyword extraction - can be enhanced with NLP
        const words = text
            .toLowerCase()
            .replace(/[^\w\s]/g, " ")
            .split(/\s+/)
            .filter((w) => w.length > 3);
        // Remove common words
        const stopWords = new Set([
            "this",
            "that",
            "with",
            "from",
            "have",
            "been",
            "were",
            "which",
            "their",
            "would",
            "there",
            "could",
            "other",
            "these",
            "about",
            "such",
            "only",
            "more",
            "into",
            "also",
            "then",
            "than",
            "some",
            "what",
            "when",
            "where",
        ]);
        const filtered = words.filter((w) => !stopWords.has(w));
        // Count frequency
        const freq = new Map();
        for (const word of filtered) {
            freq.set(word, (freq.get(word) || 0) + 1);
        }
        // Sort by frequency and return top keywords
        const sorted = Array.from(freq.entries())
            .sort((a, b) => b[1] - a[1])
            .map((e) => e[0]);
        return sorted.slice(0, 10);
    }
    /**
     * Calculate relevance score for a paper
     */
    static calculateRelevanceScore(paper, sectionText, keywords) {
        let score = 0;
        // Check title overlap
        const titleWords = paper.title.toLowerCase().split(/\s+/);
        const titleOverlap = keywords.filter((kw) => titleWords.includes(kw));
        score += titleOverlap.length * 0.3;
        // Check abstract overlap
        if (paper.abstract) {
            const abstractWords = paper.abstract.toLowerCase().split(/\s+/);
            const abstractOverlap = keywords.filter((kw) => abstractWords.includes(kw));
            score += abstractOverlap.length * 0.2;
        }
        // Boost for citation count (normalized)
        score += Math.min(paper.citationCount / 100, 1) * 0.2;
        // Boost for recent papers
        const currentYear = new Date().getFullYear();
        const age = currentYear - paper.year;
        if (age < 5) {
            score += 0.2;
        }
        else if (age < 10) {
            score += 0.1;
        }
        // Boost for fields of study match
        if (paper.fieldsOfStudy) {
            const fieldOverlap = paper.fieldsOfStudy.filter((field) => sectionText.toLowerCase().includes(field.toLowerCase()));
            score += fieldOverlap.length * 0.1;
        }
        return score;
    }
    /**
     * Get from cache if not expired
     */
    static getFromCache(key) {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
            return cached.data;
        }
        return null;
    }
    /**
     * Set cache
     */
    static setCache(key, data) {
        this.cache.set(key, { data, timestamp: Date.now() });
        // Clean old cache entries  (keep max 100)
        if (this.cache.size > 100) {
            const entries = Array.from(this.cache.entries());
            entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
            for (let i = 0; i < 20; i++) {
                this.cache.delete(entries[i][0]);
            }
        }
    }
}
exports.PaperRecommendationService = PaperRecommendationService;
