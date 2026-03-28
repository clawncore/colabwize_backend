import { AcademicDatabaseService } from "../academicDatabaseService";
import { VerificationResult, VerificationStatus } from "../../types/citationAudit";
import { CitationPair } from "./citationMatcher";
import logger from "../../monitoring/logger";

/**
 * External Verification Service - Verifies citations using academic databases
 * Now processes CitationPairs (inline + reference) with LIFO queue
 */
export class ExternalVerificationService {
    /**
     * Verify citation pairs using LIFO queue processing
     * @param pairs - Matched citation pairs (inline + reference)
     * @param userId - Optional user ID for Zotero integration
     * @returns Verification results for each inline citation
     */
    static async verifyCitationPairs(pairs: CitationPair[], userId?: string): Promise<VerificationResult[]> {
        console.log(`[ExternalVerification] Verifying ${pairs.length} citation pairs...`);
        const results: VerificationResult[] = [];
        const CONCURRENCY_LIMIT = 5; // Increased slightly for better speed

        // 1. Fetch Zotero credentials if userId is provided
        let zoteroCreds: any = null;
        if (userId) {
            const { prisma } = require("../../lib/prisma");
            zoteroCreds = await prisma.user.findUnique({
                where: { id: userId },
                select: { zotero_api_key: true, zotero_user_id: true }
            });
        }

        // 2. Process in batches
        for (let i = 0; i < pairs.length; i += CONCURRENCY_LIMIT) {
            console.log(`[ExternalVerification] Processing batch ${Math.floor(i / CONCURRENCY_LIMIT) + 1}/${Math.ceil(pairs.length / CONCURRENCY_LIMIT)}...`);
            const batch = pairs.slice(i, i + CONCURRENCY_LIMIT);
            const batchPromises = batch.map(async (pair) => {
                try {
                    return await this.verifyPair(pair, zoteroCreds);
                } catch (error) {
                    logger.error("Verification error for citation", {
                        inline: pair.inline.text,
                        error: (error as Error).message
                    });
                    return {
                        inlineLocation: {
                            start: pair.inline.start,
                            end: pair.inline.end,
                            text: pair.inline.text,
                        },
                        status: "VERIFICATION_FAILED" as const,
                        message: "Verification error occurred",
                    };
                }
            });

            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);
        }

        return results;
    }

    /**
     * Verify a single citation pair
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

        // Case 2: Reference too short to verify (e.g., only author-year)
        const wordCount = pair.reference.rawText.trim().split(/\s+/).length;
        if (wordCount <= 5) {
            console.log(`⚠️  SKIPPING (insufficient info): "${pair.inline.text}"`);
            return {
                inlineLocation,
                status: "INSUFFICIENT_INFO",
                message: "Citation is too short for automatic verification",
            };
        }

        // Case 3: Verify using academic database (DOI preferred, then search)
        let foundPaper: any = null;
        let bestMatch: any = null;

        if (pair.reference.extractedDOI) {
            console.log(`   🎯 Searching by DOI: ${pair.reference.extractedDOI}`);
            
            // --- NEW: Zotero Gold Standard Check ---
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
                    foundPaper = {
                        title: zItem.title,
                        authors: zItem.author?.map((a: any) => `${a.given} ${a.family}`).join(", "),
                        year: zItem.issued?.["date-parts"]?.[0]?.[0] || zItem.publicationDate,
                        url: zItem.URL,
                        database: "Zotero (Gold Standard)",
                        abstract: zItem.abstractNote,
                        isZoteroRecord: true
                    };
                    bestMatch = { ...foundPaper, similarity: 1.0 };
                }
            }

            if (!bestMatch) {
                foundPaper = await AcademicDatabaseService.searchByDOI(pair.reference.extractedDOI);
                if (foundPaper) {
                    bestMatch = { ...foundPaper, similarity: 1.0 };
                }
            }
        }

        let apiResults: any[] | null = null;
        if (!bestMatch) {
            const searchQuery = this.buildSearchQuery(pair.reference);

            console.log(`\n🔍 TESTING MATCHED CITATION:`);
            console.log(`   Inline: "${pair.inline.text}"`);
            console.log(`   Reference: ${pair.reference.rawText.substring(0, 80)}...`);
            console.log(`   [Verification ID: ${pair.inline.start}] Searching academic databases for: "${searchQuery}"`);
            
            // --- NEW: Zotero Title-based check ---
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
                    foundPaper = {
                        title: zItem.title,
                        authors: zItem.author?.map((a: any) => `${a.given} ${a.family}`).join(", "),
                        year: zItem.issued?.["date-parts"]?.[0]?.[0] || zItem.publicationDate,
                        url: zItem.URL,
                        database: "Zotero (Gold Standard)",
                        abstract: zItem.abstractNote,
                        isZoteroRecord: true
                    };
                    bestMatch = { ...foundPaper, similarity: 1.0 };
                }
            }

            if (!bestMatch) {
                console.log(`   [Verification ID: ${pair.inline.start}] Extracted Title: "${pair.reference.extractedTitle}"`);
                console.log(`   [Verification ID: ${pair.inline.start}] Extracted Author: "${pair.reference.extractedAuthor}"`);
                console.log(`   [Verification ID: ${pair.inline.start}] Extracted Year: ${pair.reference.extractedYear}`);
                console.log(`   🌐 Searching academic databases...`);

                logger.info("Verifying citation", {
                    inline: pair.inline.text,
                    query: searchQuery
                });

                apiResults = await AcademicDatabaseService.searchAcademicDatabases(searchQuery);
                console.log(`   📊 API Results: ${apiResults.length} papers found`);

                if (apiResults && apiResults.length > 0) {
                    bestMatch = apiResults[0];
                    console.log(`   [Verification ID: ${pair.inline.start}] Found Match: "${bestMatch.title}" (${(bestMatch.similarity * 100).toFixed(0)}% confidence)`);
                }
            }
        }

        // Case 4: No results from API
        if (!bestMatch) {
            const refTitle = pair.reference.extractedTitle || pair.reference.rawText.substring(0, 80);
            const author = pair.reference.extractedAuthor || 'Unknown';
            const year = pair.reference.extractedYear || '?';

            return {
                inlineLocation,
                status: "VERIFICATION_FAILED",
                message: `External verification inconclusive. Document matches could not be confirmed in academic databases (CrossRef, arXiv, PubMed) for: "${refTitle}" by ${author} (${year}).`,
                similarity: 0,
            };
        }

        // Case 5: Evaluate Match Quality (Tiered Scoring)
        const similarity = bestMatch.similarity;
        const refTitle = pair.reference.extractedTitle || pair.reference.rawText.substring(0, 80);

        // Perform Semantic Support Check if abstract is available
        let semanticSupport: any = undefined;
        if (bestMatch.abstract && pair.inline.context) {
            console.log(`   🧠 Performing semantic support check...`);
            const { SemanticClaimService } = require("./semanticClaimService");
            semanticSupport = await SemanticClaimService.verifyClaim(pair.inline.context, bestMatch.abstract);
            console.log(`      Status: ${semanticSupport.status}`);
        }

        const buildVerificationResult = (status: VerificationStatus, baseMessage: string, apiResults?: any[]): VerificationResult => {
            let message = baseMessage;
            if (bestMatch.isRetracted) {
                message = `🚨 RETRACTED SOURCE: ${message}`;
            }

            const existenceStatus = (status === "VERIFIED") ? "CONFIRMED" : (status === "VERIFICATION_FAILED" ? "NOT_FOUND" : "UNKNOWN");
            const supportStatus = semanticSupport?.status || "PENDING";

            return {
                inlineLocation,
                status: bestMatch.isRetracted ? "VERIFICATION_FAILED" : status,
                existenceStatus: bestMatch.isRetracted ? "NOT_FOUND" : existenceStatus,
                supportStatus: supportStatus as any,
                message: message,
                similarity: similarity,
                issues: bestMatch.isRetracted ? ["Source paper has been retracted"] : [],
                foundPaper: {
                    title: bestMatch.title,
                    year: bestMatch.year,
                    url: bestMatch.url,
                    database: bestMatch.database,
                    abstract: bestMatch.abstract,
                    isRetracted: bestMatch.isRetracted,
                    authors: bestMatch.authors
                },
                suggestedMatches: (apiResults || []).slice(0, 3).map(p => ({
                    title: p.title,
                    authors: p.authors,
                    year: p.year,
                    url: p.url,
                    database: p.database
                })),
                semanticSupport
            };
        };

        const suggestions = apiResults || (bestMatch ? [bestMatch] : []);

        // Tier 1: Poor Match (< 50%) -> Flag as Failed
        if (similarity < 0.5) {
            return buildVerificationResult(
                "VERIFICATION_FAILED",
                `⚠️ External verification inconclusive (${(similarity * 100).toFixed(0)}% match). Closest paper found: "${bestMatch.title}".`,
                suggestions
            );
        }

        // Tier 2: Fair Match (50% - 70%) -> Verified but with Qualification
        if (similarity < 0.7) {
            return buildVerificationResult(
                "VERIFIED",
                `✅ Verified (Fair Match: ${(similarity * 100).toFixed(0)}%). Found: "${bestMatch.title}".`,
                suggestions
            );
        }

        // Tier 3: Good Match (> 70%) -> Verified High Confidence
        return buildVerificationResult(
            "VERIFIED",
            `✅ Verified: "${bestMatch.title}" (${(similarity * 100).toFixed(0)}% match from ${bestMatch.database})`,
            suggestions
        );
    }

    /**
     * Build search query from reference data
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
            if (reference.extractedAuthor) {
                parts.push(reference.extractedAuthor);
            }
            if (reference.extractedYear) {
                parts.push(reference.extractedYear.toString());
            }
            return parts.join(" ");
        }

        // Fallback to raw text if title parsing failed
        // Remove URLs to avoid breaking search APIs
        return reference.rawText.replace(/https?:\/\/[^\s]+/g, "").substring(0, 200).trim();
    }
}
