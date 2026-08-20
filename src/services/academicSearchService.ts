import { SemanticScholarService, AcademicPaper } from "./semanticScholarService";
import { OpenAlexService } from "./openAlexService";
import { ArxivService } from "./arxivService";
import { PubmedService } from "./pubmedService";
import { IEEEService } from "./ieeeService";
import { DOAJService } from "./doajService";
import { CrossRefService } from "./crossRefService";
import logger from "../monitoring/logger";
import { createHash } from "crypto";

/** In-memory cache entry for search results */
interface CacheEntry {
    papers: AcademicPaper[];
    timestamp: number;
}

export class AcademicSearchService {
    /** In-memory cache: normalized query → results */
    private static readonly queryCache = new Map<string, CacheEntry>();
    /** Cache TTL: 1 hour */
    private static readonly CACHE_TTL_MS = 60 * 60 * 1000;
    /** Max cache entries before eviction */
    private static readonly MAX_CACHE_ENTRIES = 500;

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
                logger.info(`[AcademicSearchService] Evicted ${evicted} expired cache entries.`);
            }
        }, 15 * 60 * 1000);
        timer.unref(); // Don't keep process alive during tests
    }

    /**
     * Normalize a query for consistent cache keys.
     */
    private static normalizeQuery(query: string): string {
        return query.toLowerCase().trim().replace(/\s+/g, " ");
    }

    /**
     * Get cache key for a query.
     */
    private static cacheKey(query: string): string {
        return createHash("sha256").update(this.normalizeQuery(query)).digest("hex");
    }

    /**
     * Evict expired entries and enforce max size.
     */
    private static evictCache(): void {
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
    static async searchPapers(query: string, limit: number = 50): Promise<AcademicPaper[]> {
        const normalized = this.normalizeQuery(query);
        const key = this.cacheKey(query);

        // Check cache
        const cached = this.queryCache.get(key);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
            logger.info(`[AcademicSearchService] Cache hit for query: "${normalized.substring(0, 60)}..."`);
            return this.deduplicateAndRank(cached.papers, limit);
        }

        try {
            // Search across all providers in parallel
            const results = await Promise.allSettled([
                SemanticScholarService.searchPapers(query, 10),
                OpenAlexService.searchPapers(query, 10),
                ArxivService.searchPapers(query, 10),
                PubmedService.searchPapers(query, 10),
                IEEEService.searchPapers(query, 10),
                DOAJService.searchPapers(query, 10),
                CrossRefService.searchPapers(query, 10)
            ]);

            const allPapers: AcademicPaper[] = [];
            results.forEach((result, index) => {
                if (result.status === "fulfilled") {
                    allPapers.push(...result.value);
                } else {
                    logger.warn(`Search provider ${index} failed`, { error: result.reason });
                }
            });

            // Cache the full result set (before limit truncation)
            this.evictCache();
            this.queryCache.set(key, { papers: allPapers, timestamp: Date.now() });

            // Deduplicate and rank
            return this.deduplicateAndRank(allPapers, limit);

        } catch (error: any) {
            logger.error("Academic search aggregation failed", { error: error.message });
            return [];
        }
    }

    /**
     * Clear the entire search cache. Useful for testing or admin operations.
     */
    static clearCache(): void {
        this.queryCache.clear();
    }

    /**
     * Get cache stats for monitoring.
     */
    static getCacheStats(): { size: number; maxEntries: number; ttlMs: number } {
        return {
            size: this.queryCache.size,
            maxEntries: this.MAX_CACHE_ENTRIES,
            ttlMs: this.CACHE_TTL_MS,
        };
    }

    private static deduplicateAndRank(papers: AcademicPaper[], limit: number): AcademicPaper[] {
        const uniquePapers: AcademicPaper[] = [];
        const seenTitles = new Set<string>();

        // Sort by Semantic Scholar prioritization, then by quality/citation count where available
        const sorted = [...papers].sort((a, b) => {
            if (a.source === "semantic_scholar" && b.source !== "semantic_scholar") return -1;
            if (b.source === "semantic_scholar" && a.source !== "semantic_scholar") return 1;
            return (b.citationCount || 0) - (a.citationCount || 0);
        });

        for (const paper of sorted) {
            const normalizedTitle = paper.title.toLowerCase().trim().replace(/[^\w\s]/g, "");

            // Check for near-duplicates (simple subset check for titles)
            let isDuplicate = false;
            if (seenTitles.has(normalizedTitle)) {
                isDuplicate = true;
            } else {
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

            if (uniquePapers.length >= limit) break;
        }

        return uniquePapers;
    }

    /**
     * "Legitimize" a claim: Find a real paper that supports a statement.
     */
    static async findEvidenceForClaim(claim: string): Promise<AcademicPaper[]> {
        return this.searchPapers(claim, 5);
    }
}
