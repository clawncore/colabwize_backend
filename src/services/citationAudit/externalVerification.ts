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
     * @returns Verification results for each inline citation
     */
    static async verifyCitationPairs(pairs: CitationPair[]): Promise<VerificationResult[]> {
        const results: VerificationResult[] = [];

        // Process queue in LIFO order (Last In, First Out)
        const queue = [...pairs]; // Copy array

        while (queue.length > 0) {
            const pair = queue.pop(); // Take from end (LIFO)

            if (!pair) continue;

            try {
                const result = await this.verifyPair(pair);
                results.push(result);
            } catch (error) {
                logger.error("Verification error for citation", {
                    inline: pair.inline.text,
                    error: (error as Error).message
                });

                // Add error result
                results.push({
                    inlineLocation: {
                        start: pair.inline.start,
                        end: pair.inline.end,
                        text: pair.inline.text,
                    },
                    status: "VERIFICATION_FAILED",
                    message: "Verification error occurred",
                });
            }
        }

        return results;
    }

    /**
     * Verify a single citation pair
     */
    private static async verifyPair(pair: CitationPair): Promise<VerificationResult> {
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
        if (wordCount <= 5 || !pair.reference.extractedTitle) {
            console.log(`⚠️  SKIPPING (insufficient info): "${pair.inline.text}"`);
            return {
                inlineLocation,
                status: "INSUFFICIENT_INFO",
                message: "Citation lacks title information for automatic verification",
            };
        }

        // Case 3: Verify using academic database (DOI preferred, then search)
        let foundPaper: any = null;
        let bestMatch: any = null;

        if (pair.reference.extractedDOI) {
            console.log(`   🎯 Searching by DOI: ${pair.reference.extractedDOI}`);
            foundPaper = await AcademicDatabaseService.searchByDOI(pair.reference.extractedDOI);
            if (foundPaper) {
                bestMatch = { ...foundPaper, similarity: 1.0 };
            }
        }

        if (!bestMatch) {
            const searchQuery = this.buildSearchQuery(pair.reference);

            console.log(`\n🔍 TESTING MATCHED CITATION:`);
            console.log(`   Inline: "${pair.inline.text}"`);
            console.log(`   Reference: ${pair.reference.rawText.substring(0, 80)}...`);
            console.log(`   Extracted Title: "${pair.reference.extractedTitle}"`);
            console.log(`   Extracted Author: "${pair.reference.extractedAuthor}"`);
            console.log(`   Extracted Year: ${pair.reference.extractedYear}`);
            console.log(`   Search Query: "${searchQuery}"`);
            console.log(`   🌐 Searching academic databases...`);

            logger.info("Verifying citation", {
                inline: pair.inline.text,
                query: searchQuery
            });

            const apiResults = await AcademicDatabaseService.searchAcademicDatabases(searchQuery);
            console.log(`   📊 API Results: ${apiResults.length} papers found`);

            if (apiResults.length > 0) {
                bestMatch = apiResults[0];
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
                message: `Paper not found in academic databases (CrossRef, arXiv, PubMed). Reference: "${refTitle}" by ${author} (${year}). This may indicate a hallucinated or non-existent source.`,
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

        const buildVerificationResult = (status: VerificationStatus, baseMessage: string): VerificationResult => {
            let message = baseMessage;
            if (bestMatch.isRetracted) {
                message = `🚨 RETRACTED SOURCE: ${message}`;
            }

            return {
                inlineLocation,
                status: bestMatch.isRetracted ? "VERIFICATION_FAILED" : status,
                message: message,
                similarity: similarity,
                foundPaper: {
                    title: bestMatch.title,
                    year: bestMatch.year,
                    url: bestMatch.url,
                    database: bestMatch.database,
                    abstract: bestMatch.abstract,
                    isRetracted: bestMatch.isRetracted
                },
                semanticSupport
            };
        };

        // Tier 1: Poor Match (< 50%) -> Flag as Failed
        if (similarity < 0.5) {
            return buildVerificationResult(
                "VERIFICATION_FAILED",
                `⚠️ Poor match quality (${(similarity * 100).toFixed(0)}%). Closest paper: "${bestMatch.title}". Verification cannot be confirmed.`
            );
        }

        // Tier 2: Fair Match (50% - 70%) -> Verified but with Qualification
        if (similarity < 0.7) {
            return buildVerificationResult(
                "VERIFIED",
                `✅ Verified (Fair Match: ${(similarity * 100).toFixed(0)}%). Found: "${bestMatch.title}".`
            );
        }

        // Tier 3: Good Match (> 70%) -> Verified High Confidence
        return buildVerificationResult(
            "VERIFIED",
            `✅ Verified: "${bestMatch.title}" (${(similarity * 100).toFixed(0)}% match from ${bestMatch.database})`
        );
    }

    /**
     * Build search query from reference data
     */
    private static buildSearchQuery(reference: {
        extractedTitle?: string;
        extractedAuthor?: string;
        extractedYear?: number;
    }): string {
        const parts: string[] = [];

        if (reference.extractedTitle) {
            parts.push(reference.extractedTitle);
        }

        if (reference.extractedAuthor) {
            parts.push(reference.extractedAuthor);
        }

        if (reference.extractedYear) {
            parts.push(reference.extractedYear.toString());
        }

        return parts.join(" ");
    }
}
