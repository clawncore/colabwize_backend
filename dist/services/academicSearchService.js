"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AcademicSearchService = void 0;
const semanticScholarService_1 = require("./semanticScholarService");
const openAlexService_1 = require("./openAlexService");
const arxivService_1 = require("./arxivService");
const pubmedService_1 = require("./pubmedService");
const ieeeService_1 = require("./ieeeService");
const doajService_1 = require("./doajService");
const crossRefService_1 = require("./crossRefService");
const logger_1 = __importDefault(require("../monitoring/logger"));
const crypto_1 = require("crypto");
class AcademicSearchService {
    /** In-memory cache: normalized query → results */
    static queryCache = new Map();
    /** Cache TTL: 1 hour */
    static CACHE_TTL_MS = 60 * 60 * 1000;
    /** Max cache entries before eviction */
    static MAX_CACHE_ENTRIES = 500;
    // Periodic eviction every 15 minutes to clean up expired entries
    // Uses unref() so it doesn't keep the Node.js process alive during tests
    static {
        const timer = setInterval(() => {
            const now = Date.now();
            let evicted = 0;
            for (const [key, entry] of AcademicSearchService.queryCache) {
                if (now - entry.timestamp > AcademicSearchService.CACHE_TTL_MS) {
                    AcademicSearchService.queryCache.delete(key);
                    evicted++;
                }
            }
            if (evicted > 0) {
                logger_1.default.info(`[AcademicSearchService] Evicted ${evicted} expired cache entries.`);
            }
        }, 15 * 60 * 1000);
        timer.unref(); // Don't keep process alive during tests
    }
    /**
     * Normalize a query for consistent cache keys.
     */
    static normalizeQuery(query) {
        return query.toLowerCase().trim().replace(/\s+/g, " ");
    }
    /**
     * Get cache key for a query.
     */
    static cacheKey(query) {
        return (0, crypto_1.createHash)("sha256").update(this.normalizeQuery(query)).digest("hex");
    }
    /**
     * Evict expired entries and enforce max size.
     */
    static evictCache() {
        const now = Date.now();
        // Remove expired entries
        for (const [key, entry] of this.queryCache) {
            if (now - entry.timestamp > this.CACHE_TTL_MS) {
                this.queryCache.delete(key);
            }
        }
        // If still over limit, remove oldest entries
        if (this.queryCache.size > this.MAX_CACHE_ENTRIES) {
            const entries = Array.from(this.queryCache.entries());
            entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
            const toRemove = entries.slice(0, this.queryCache.size - this.MAX_CACHE_ENTRIES);
            for (const [key] of toRemove) {
                this.queryCache.delete(key);
            }
        }
    }
    /**
     * Search papers across multiple databases and aggregate results.
     * Results are cached by normalized query to avoid redundant API calls
     * when multiple citations search for the same paper.
     */
    static async searchPapers(query, limit = 50) {
        const normalized = this.normalizeQuery(query);
        const key = this.cacheKey(query);
        // Check cache
        const cached = this.queryCache.get(key);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
            logger_1.default.info(`[AcademicSearchService] Cache hit for query: "${normalized.substring(0, 60)}..."`);
            return this.deduplicateAndRank(cached.papers, limit);
        }
        try {
            // Search across all providers in parallel
            const results = await Promise.allSettled([
                semanticScholarService_1.SemanticScholarService.searchPapers(query, 10),
                openAlexService_1.OpenAlexService.searchPapers(query, 10),
                arxivService_1.ArxivService.searchPapers(query, 10),
                pubmedService_1.PubmedService.searchPapers(query, 10),
                ieeeService_1.IEEEService.searchPapers(query, 10),
                doajService_1.DOAJService.searchPapers(query, 10),
                crossRefService_1.CrossRefService.searchPapers(query, 10)
            ]);
            const allPapers = [];
            results.forEach((result, index) => {
                if (result.status === "fulfilled") {
                    allPapers.push(...result.value);
                }
                else {
                    logger_1.default.warn(`Search provider ${index} failed`, { error: result.reason });
                }
            });
            // Cache the full result set (before limit truncation)
            this.evictCache();
            this.queryCache.set(key, { papers: allPapers, timestamp: Date.now() });
            // Deduplicate and rank
            return this.deduplicateAndRank(allPapers, limit);
        }
        catch (error) {
            logger_1.default.error("Academic search aggregation failed", { error: error.message });
            return [];
        }
    }
    /**
     * Clear the entire search cache. Useful for testing or admin operations.
     */
    static clearCache() {
        this.queryCache.clear();
    }
    /**
     * Get cache stats for monitoring.
     */
    static getCacheStats() {
        return {
            size: this.queryCache.size,
            maxEntries: this.MAX_CACHE_ENTRIES,
            ttlMs: this.CACHE_TTL_MS,
        };
    }
    static deduplicateAndRank(papers, limit) {
        const uniquePapers = [];
        const seenTitles = new Set();
        // Sort by Semantic Scholar prioritization, then by quality/citation count where available
        const sorted = [...papers].sort((a, b) => {
            if (a.source === "semantic_scholar" && b.source !== "semantic_scholar")
                return -1;
            if (b.source === "semantic_scholar" && a.source !== "semantic_scholar")
                return 1;
            return (b.citationCount || 0) - (a.citationCount || 0);
        });
        for (const paper of sorted) {
            const normalizedTitle = paper.title.toLowerCase().trim().replace(/[^\w\s]/g, "");
            // Check for near-duplicates (simple subset check for titles)
            let isDuplicate = false;
            if (seenTitles.has(normalizedTitle)) {
                isDuplicate = true;
            }
            else {
                for (const existing of seenTitles) {
                    if (normalizedTitle.includes(existing) || existing.includes(normalizedTitle)) {
                        isDuplicate = true;
                        break;
                    }
                }
            }
            if (!isDuplicate) {
                uniquePapers.push(paper);
                seenTitles.add(normalizedTitle);
            }
            if (uniquePapers.length >= limit)
                break;
        }
        return uniquePapers;
    }
    /**
     * "Legitimize" a claim: Find a real paper that supports a statement.
     */
    static async findEvidenceForClaim(claim) {
        return this.searchPapers(claim, 5);
    }
}
exports.AcademicSearchService = AcademicSearchService;
