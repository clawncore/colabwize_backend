import { AcademicDatabaseService } from "../academicDatabaseService";
import { AcademicSearchService } from "../academicSearchService";
import { AcademicPaper } from "../semanticScholarService";
import { SemanticScholarService } from "../semanticScholarService";
import { VerificationResult, VerificationStatus } from "../../types/citationAudit";
import { CitationPair } from "./citationMatcher";
import logger from "../../monitoring/logger";
import { createHash } from "crypto";

/**
 * External Verification Service - Verifies citations using academic databases.
 * Uses AcademicSearchService which queries all 7 APIs in parallel:
 * CrossRef, OpenAlex, arXiv, PubMed, Semantic Scholar, IEEE Xplore, DOAJ.
 *
 * Optimizations:
 * - Concurrency-limited parallel verification (prevents rate-limit overwhelm)
 * - Content-hash based caching (skips re-verification of unchanged citations)
 * - Incremental audit support (only verifies changed pairs)
 * - Per-pair timeout (60s) to prevent hanging
 * - Skips semantic check on low-similarity matches (< 50%)
 */
export class ExternalVerificationService {
    /** Max concurrent verification pairs to avoid overwhelming rate-limited APIs */
    private static readonly CONCURRENCY_LIMIT = 10;
    /** Per-pair timeout in milliseconds */
    private static readonly PAIR_TIMEOUT_MS = 60_000;
    /** Cache TTL in milliseconds (7 days) */
    private static readonly CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

    /**
     * Verify citation pairs with concurrency limiting and caching.
     */
    static async verifyCitationPairs(
        pairs: CitationPair[],
        userId?: string,
        options?: { skipUnchanged?: boolean; previousHashes?: Set<string> }
    ): Promise<VerificationResult[]> {
        console.log(`[ExternalVerification] Verifying ${pairs.length} citation pairs...`);

        // Fetch Zotero credentials once for all pairs
        let zoteroCreds: any = null;
        if (userId) {
            const { prisma } = require("../../lib/prisma");
            zoteroCreds = await prisma.user.findUnique({
                where: { id: userId },
                select: { zotero_api_key: true, zotero_user_id: true }
            });
        }

        // Build cache lookup and identify pairs that need verification
        const pairsToVerify: Array<{ pair: CitationPair; originalIndex: number }> = [];
        const cachedResults: Array<{ result: VerificationResult; originalIndex: number }> = [];

        for (let i = 0; i < pairs.length; i++) {
            const pair = pairs[i];
            const hash = this.computePairHash(pair);

            // Incremental audit: skip unchanged pairs
            if (options?.skipUnchanged && options?.previousHashes?.has(hash)) {
                cachedResults.push({
                    result: {
                        inlineLocation: {
                            start: pair.inline.start,
                            end: pair.inline.end,
                            text: pair.inline.text,
                        },
                        status: "VERIFIED",
                        message: "Unchanged from previous audit — skipped re-verification.",
                        existenceStatus: "CONFIRMED",
                        supportStatus: "PENDING",
                        similarity: 1.0,
                        _cached: true,
                        _cacheReason: "unchanged",
                    } as any,
                    originalIndex: i,
                });
                continue;
            }

            // Check content-hash cache
            const cached = await this.checkCache(hash);
            if (cached) {
                cachedResults.push({ result: cached, originalIndex: i });
                continue;
            }

            pairsToVerify.push({ pair, originalIndex: i });
        }

        console.log(
            `[ExternalVerification] Cache hits: ${cachedResults.length}, To verify: ${pairsToVerify.length}`
        );

        // Process pairs with concurrency limiting
        const verifiedResults: Array<{ result: VerificationResult; originalIndex: number }> = [];

        // Process in batches of CONCURRENCY_LIMIT
        for (let i = 0; i < pairsToVerify.length; i += this.CONCURRENCY_LIMIT) {
            const batch = pairsToVerify.slice(i, i + this.CONCURRENCY_LIMIT);
            const batchResults = await Promise.all(
                batch.map(({ pair, originalIndex }) =>
                    this.verifyPairWithTimeout(pair, zoteroCreds).then((result) => {
                        // Store in cache asynchronously (don't block)
                        const hash = this.computePairHash(pair);
                        this.storeCache(hash, result).catch(() => {});
                        return { result, originalIndex };
                    }).catch((error) => {
                        const err = error as Error;
                        const message = err?.message ?? "Verification error occurred";
                        const looksLikeProviderIssue =
                            /timeout|timed out|econnreset|fetch failed|socket hang up|network|unavailable|rate.?limit|429|503/i.test(
                                message,
                            );

                        logger.error("Verification error for citation", {
                            inline: pair.inline.text,
                            error: message,
                        });

                        return {
                            result: {
                                inlineLocation: {
                                    start: pair.inline.start,
                                    end: pair.inline.end,
                                    text: pair.inline.text,
                                },
                                status: (looksLikeProviderIssue ? "RETRY_REQUIRED" : "VERIFICATION_FAILED") as VerificationStatus,
                                message: looksLikeProviderIssue
                                    ? "The academic database provider is currently unavailable. Please retry this citation in a few minutes."
                                    : message,
                                existenceStatus: "UNKNOWN",
                                supportStatus: "PENDING",
                                similarity: 0,
                            } as VerificationResult,
                            originalIndex,
                        };
                    })
                )
            );
            verifiedResults.push(...batchResults);
        }

        // Merge all results in original order
        const allResults = [...cachedResults, ...verifiedResults];
        allResults.sort((a, b) => a.originalIndex - b.originalIndex);

        return allResults.map((r) => r.result);
    }

    /**
     * Verify a single pair with a timeout to prevent hanging.
     */
    private static async verifyPairWithTimeout(
        pair: CitationPair,
        zoteroCreds?: any
    ): Promise<VerificationResult> {
        return new Promise<VerificationResult>((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`Verification timed out after ${this.PAIR_TIMEOUT_MS}ms for "${pair.inline.text}"`));
            }, this.PAIR_TIMEOUT_MS);

            this.verifyPair(pair, zoteroCreds)
                .then((result) => {
                    clearTimeout(timer);
                    resolve(result);
                })
                .catch((error) => {
                    clearTimeout(timer);
                    reject(error);
                });
        });
    }

    /**
     * Compute a content hash for a citation pair for caching/incremental audit.
     */
    static computePairHash(pair: CitationPair): string {
        const content = JSON.stringify({
            inline: pair.inline.text,
            ref: pair.reference?.rawText ?? "",
            doi: pair.reference?.extractedDOI ?? "",
        });
        return createHash("sha256").update(content).digest("hex");
    }

    /**
     * Check the verification cache for a given hash.
     */
    private static async checkCache(hash: string): Promise<VerificationResult | null> {
        try {
            const { prisma } = require("../../lib/prisma");
            if (!prisma.verificationCache) return null;
            const cached = await prisma.verificationCache.findUnique({
                where: { hash },
            });
            if (!cached) return null;

            // Check TTL
            const age = Date.now() - cached.created_at.getTime();
            if (age > this.CACHE_TTL_MS) {
                // Expired — delete in background
                prisma.verificationCache.delete({ where: { hash } }).catch(() => {});
                return null;
            }

            // Increment hit counter in background
            prisma.verificationCache.update({
                where: { hash },
                data: { hits: { increment: 1 } },
            }).catch(() => {});

            return cached.result_json as VerificationResult;
        } catch {
            return null; // Cache failure should never block verification
        }
    }

    /**
     * Store a verification result in the cache.
     */
    private static async storeCache(hash: string, result: VerificationResult): Promise<void> {
        try {
            const { prisma } = require("../../lib/prisma");
            if (!prisma.verificationCache) return;
            await prisma.verificationCache.upsert({
                where: { hash },
                create: {
                    hash,
                    result_json: result as any,
                },
                update: {
                    result_json: result as any,
                    created_at: new Date(), // Reset TTL on update
                    hits: 0,
                },
            });
        } catch {
            // Cache write failure should never block verification
        }
    }

    /**
     * Verify a single citation pair against all academic databases.
     */
    private static async verifyPair(pair: CitationPair, zoteroCreds?: any): Promise<VerificationResult> {
        const inlineLocation = {
            start: pair.inline.start,
            end: pair.inline.end,
            text: pair.inline.text,
        };

        // Case 1: No matching reference found
        if (!pair.reference) {
            return {
                inlineLocation,
                status: "UNMATCHED_REFERENCE",
                message: `No matching reference found for citation "${pair.inline.text}"`,
            };
        }

        // Case 2: Reference too short to verify
        const wordCount = pair.reference.rawText.trim().split(/\s+/).length;
        if (wordCount <= 5) {
            console.log(`⚠️  SKIPPING (insufficient info): "${pair.inline.text}"`);
            return {
                inlineLocation,
                status: "INSUFFICIENT_INFO",
                message: "Citation is too short for automatic verification",
            };
        }

        // Case 3: Verify — DOI first (most precise), then full-text search across all 7 APIs
        let bestMatch: any = null;
        let apiResults: AcademicPaper[] = [];

        if (pair.reference.extractedDOI) {
            console.log(`   🎯 Searching by DOI: ${pair.reference.extractedDOI}`);

            // 3a. Zotero Gold Standard (user's own library)
            if (zoteroCreds?.zotero_api_key && zoteroCreds?.zotero_user_id) {
                const { ZoteroService } = require("../zoteroService");
                const zoteroItems = await ZoteroService.queryItems(
                    zoteroCreds.zotero_user_id,
                    zoteroCreds.zotero_api_key,
                    pair.reference.extractedDOI
                );
                if (zoteroItems && zoteroItems.length > 0) {
                    const zItem = zoteroItems[0];
                    console.log(`   🏆 GOLD STANDARD MATCH (Zotero): "${zItem.title}"`);
                    bestMatch = {
                        title: zItem.title,
                        authors: zItem.author?.map((a: any) => `${a.given} ${a.family}`).join(", "),
                        year: zItem.issued?.["date-parts"]?.[0]?.[0] || zItem.publicationDate,
                        url: zItem.URL,
                        database: "Zotero (Gold Standard)",
                        abstract: zItem.abstractNote,
                        similarity: 1.0,
                    };
                }
            }

            // 3b. CrossRef DOI lookup (primary — most authoritative for DOIs)
            if (!bestMatch) {
                const doiResult = await AcademicDatabaseService.searchByDOI(pair.reference.extractedDOI);
                if (doiResult) {
                    bestMatch = { ...doiResult, similarity: 1.0 };
                }
            }

            // 3c. Semantic Scholar DOI lookup (fallback — better abstract coverage)
            if (!bestMatch) {
                const ssResult = await SemanticScholarService.getPaperByDoi(pair.reference.extractedDOI);
                if (ssResult) {
                    console.log(`   📚 Semantic Scholar DOI match: "${ssResult.title}"`);
                    bestMatch = {
                        title: ssResult.title,
                        authors: ssResult.authors?.join(", "),
                        year: ssResult.year,
                        url: ssResult.url,
                        database: "semantic_scholar",
                        abstract: ssResult.abstract,
                        similarity: 1.0,
                    };
                }
            }
        }

        // Case 4: No DOI match — search across ALL 7 APIs in parallel
        if (!bestMatch) {
            const searchQuery = this.buildSearchQuery(pair.reference);

            console.log(`\n🔍 TESTING MATCHED CITATION:`);
            console.log(`   Inline: "${pair.inline.text}"`);
            console.log(`   Reference: ${pair.reference.rawText.substring(0, 80)}...`);
            console.log(`   [Verification ID: ${pair.inline.start}] Searching all 7 academic databases for: "${searchQuery}"`);

            // 4a. Zotero title-based check
            if (zoteroCreds?.zotero_api_key && zoteroCreds?.zotero_user_id) {
                const { ZoteroService } = require("../zoteroService");
                const zoteroItems = await ZoteroService.queryItems(
                    zoteroCreds.zotero_user_id,
                    zoteroCreds.zotero_api_key,
                    searchQuery
                );
                if (zoteroItems && zoteroItems.length > 0) {
                    const zItem = zoteroItems[0];
                    console.log(`   🏆 GOLD STANDARD MATCH (Zotero Title Query): "${zItem.title}"`);
                    bestMatch = {
                        title: zItem.title,
                        authors: zItem.author?.map((a: any) => `${a.given} ${a.family}`).join(", "),
                        year: zItem.issued?.["date-parts"]?.[0]?.[0] || zItem.publicationDate,
                        url: zItem.URL,
                        database: "Zotero (Gold Standard)",
                        abstract: zItem.abstractNote,
                        similarity: 1.0,
                    };
                }
            }

            // 4b. Full search across all 7 APIs (CrossRef + OpenAlex + arXiv + PubMed + SemanticScholar + IEEE + DOAJ)
            if (!bestMatch) {
                console.log(`   🌐 Searching all 7 academic databases in parallel...`);
                logger.info("Verifying citation", { inline: pair.inline.text, query: searchQuery });

                apiResults = await AcademicSearchService.searchPapers(searchQuery, 10);
                console.log(`   📊 Aggregated API Results: ${apiResults.length} unique papers found`);

                if (apiResults.length > 0) {
                    // Calculate similarity against the reference text for ranking
                    const refText = pair.reference.rawText.toLowerCase();
                    for (const paper of apiResults) {
                        paper.similarity = this.calculateSimilarity(refText, paper.title, paper.abstract);
                    }
                    // Re-sort by similarity after scoring
                    apiResults.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
                    bestMatch = apiResults[0];
                    console.log(`   [Verification ID: ${pair.inline.start}] Best Match: "${bestMatch.title}" (${((bestMatch.similarity || 0) * 100).toFixed(0)}% similarity, source: ${bestMatch.source})`);
                }
            }
        }

        // Case 5: No results from any API
        if (!bestMatch) {
            const refTitle = pair.reference.extractedTitle || pair.reference.rawText.substring(0, 80);
            const author = pair.reference.extractedAuthor || 'Unknown';
            const year = pair.reference.extractedYear || '?';

            const looksLikeBookOrArchive =
                Boolean(pair.reference.extractedDOI) ||
                wordCount <= 12 ||
                /(proceedings|conference|thesis|dissertation|report|archive|museum|library|chapter|edition)/i.test(
                    pair.reference.rawText,
                );

            return {
                inlineLocation,
                status: looksLikeBookOrArchive ? "INSUFFICIENT_EVIDENCE" : "VERIFICATION_FAILED",
                message: looksLikeBookOrArchive
                    ? `Source could not be automatically verified. Short or DOI-only references often indicate books, historical sources, or local archives.`
                    : `External verification inconclusive. Could not confirm in any academic database (CrossRef, OpenAlex, arXiv, PubMed, Semantic Scholar, IEEE, DOAJ) for: "${refTitle}" by ${author} (${year}).`,
                existenceStatus: looksLikeBookOrArchive ? "UNKNOWN" : "NOT_FOUND",
                supportStatus: "PENDING",
                similarity: 0,
            };
        }

        // Case 6: Evaluate Match Quality (Tiered Scoring)
        const similarity = bestMatch.similarity || 0;

        // Retracted sources get an explicit fabrication signal
        if (bestMatch.isRetracted) {
            return {
                inlineLocation,
                status: "POTENTIAL_FABRICATION",
                existenceStatus: "NOT_FOUND",
                supportStatus: "PENDING",
                message: `🚨 Retracted source detected: "${bestMatch.title}". This paper has been retracted and should not be cited without acknowledgement.`,
                similarity,
                issues: ["Source paper has been retracted"],
                foundPaper: {
                    title: bestMatch.title,
                    year: bestMatch.year,
                    url: bestMatch.url,
                    database: bestMatch.database,
                    abstract: bestMatch.abstract,
                    isRetracted: bestMatch.isRetracted,
                    authors: bestMatch.authors,
                },
                suggestedMatches: [],
            };
        }

        // Semantic Support Check (AI) — only if abstract available AND similarity is meaningful
        // Skip for low-similarity matches (< 50%) to save OpenAI API calls
        let semanticSupport: any = undefined;
        if (bestMatch.abstract && pair.inline.context && similarity >= 0.5) {
            console.log(`   🧠 Performing semantic support check...`);
            const { SemanticClaimService } = require("./semanticClaimService");
            semanticSupport = await SemanticClaimService.verifyClaim(pair.inline.context, bestMatch.abstract);
            console.log(`      Status: ${semanticSupport.status}`);
        } else if (bestMatch.abstract && pair.inline.context && similarity < 0.5) {
            console.log(`   ⏭️  Skipping semantic check (similarity ${(similarity * 100).toFixed(0)}% < 50% threshold)`);
        }

        const buildResult = (status: VerificationStatus, message: string): VerificationResult => ({
            inlineLocation,
            status,
            existenceStatus: status === "VERIFIED" ? "CONFIRMED" : "NOT_FOUND",
            supportStatus: (semanticSupport?.status || "PENDING") as any,
            message,
            similarity,
            issues: [],
            foundPaper: {
                title: bestMatch.title,
                year: bestMatch.year,
                url: bestMatch.url,
                database: bestMatch.database,
                abstract: bestMatch.abstract,
                isRetracted: bestMatch.isRetracted,
                authors: bestMatch.authors,
            },
            suggestedMatches: apiResults.slice(0, 3).map((p) => ({
                title: p.title,
                authors: p.authors,
                year: p.year,
                url: p.url,
                database: p.source,
            })),
            semanticSupport,
        });

        // Tier 1: Poor Match (< 50%)
        if (similarity < 0.5) {
            return buildResult(
                "VERIFICATION_FAILED",
                `⚠️ External verification inconclusive (${(similarity * 100).toFixed(0)}% match). Closest paper found: "${bestMatch.title}".`
            );
        }

        // Tier 2: Fair Match (50% - 70%)
        if (similarity < 0.7) {
            return buildResult(
                "VERIFIED",
                `✅ Verified (Fair Match: ${(similarity * 100).toFixed(0)}%). Found: "${bestMatch.title}".`
            );
        }

        // Tier 3: Good Match (> 70%)
        return buildResult(
            "VERIFIED",
            `✅ Verified: "${bestMatch.title}" (${(similarity * 100).toFixed(0)}% match from ${bestMatch.database})`
        );
    }

    /**
     * Calculate similarity between reference text and a paper's title + abstract.
     */
    private static calculateSimilarity(refText: string, title?: string, abstract?: string): number {
        if (!title) return 0;
        const titleScore = this.compareStrings(refText, title.toLowerCase());
        if (!abstract) return titleScore;
        const abstractScore = this.compareStrings(refText, abstract.substring(0, 500).toLowerCase());
        return Math.max(titleScore, abstractScore * 0.8); // Title match weighted higher
    }

    private static compareStrings(a: string, b: string): number {
        if (!a || !b || a.length < 10 || b.length < 10) return 0;
        // Simple Jaccard-like word overlap for speed (no external lib needed)
        const wordsA = new Set(a.split(/\s+/));
        const wordsB = new Set(b.split(/\s+/));
        let overlap = 0;
        for (const w of wordsA) {
            if (wordsB.has(w)) overlap++;
        }
        return overlap / Math.max(wordsA.size, wordsB.size);
    }

    /**
     * Build search query from reference data.
     */
    private static buildSearchQuery(reference: {
        rawText: string;
        extractedTitle?: string;
        extractedAuthor?: string;
        extractedYear?: number;
    }): string {
        const parts: string[] = [];

        if (reference.extractedTitle) {
            parts.push(reference.extractedTitle);
            if (reference.extractedAuthor) parts.push(reference.extractedAuthor);
            if (reference.extractedYear) parts.push(reference.extractedYear.toString());
            return parts.join(" ");
        }

        // Fallback: clean raw text, remove URLs, limit length
        return reference.rawText.replace(/https?:\/\/[^\s]+/g, "").substring(0, 200).trim();
    }
}
