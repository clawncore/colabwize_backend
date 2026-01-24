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

        // Case 3: Verify using academic database
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
            console.log(`   📄 Top matches:`);
            apiResults.slice(0, 3).forEach((result, i) => {
                console.log(`      ${i + 1}. "${result.title}" (${(result.similarity * 100).toFixed(0)}% match) - ${result.database}`);
            });
        } else {
            console.log(`   ❌ NO RESULTS from APIs`);
        }

        // Case 4: No results from API
        if (apiResults.length === 0) {
            const refTitle = pair.reference.extractedTitle || pair.reference.rawText.substring(0, 80);
            const author = pair.reference.extractedAuthor || 'Unknown';
            const year = pair.reference.extractedYear || '?';

            return {
                inlineLocation,
                status: "VERIFICATION_FAILED",
                message: `Paper not found in academic databases (CrossRef, arXiv, PubMed). Reference: "${refTitle}" by ${author} (${year}). This may indicate: (1) The paper doesn't exist, (2) Incorrect citation details, or (3) Not indexed in free databases yet.`,
                similarity: 0,
            };
        }

        // Case 5: Evaluate Match Quality (Tiered Scoring)
        const bestMatch = apiResults[0];
        const similarity = bestMatch.similarity;
        const refTitle = pair.reference.extractedTitle || pair.reference.rawText.substring(0, 80);

        // Tier 1: Poor Match (< 50%) -> Flag as Failed with Specific Reason
        if (similarity < 0.5) {
            return {
                inlineLocation,
                status: "VERIFICATION_FAILED",
                message: `⚠️ Poor match quality (${(similarity * 100).toFixed(0)}%). Closest paper: "${bestMatch.title}". This usually means the citation has typos, incorrect year, or is very obscure.`,
                similarity: similarity,
                foundPaper: {
                    title: bestMatch.title,
                    year: bestMatch.year,
                    url: bestMatch.url,
                    database: bestMatch.database,
                },
            };
        }

        // Tier 2: Fair Match (50% - 70%) -> Verified but with Qualification
        if (similarity < 0.7) {
            return {
                inlineLocation,
                status: "VERIFIED",
                message: `✅ Verified (Fair Match: ${(similarity * 100).toFixed(0)}%). Found: "${bestMatch.title}".`,
                similarity: similarity,
                foundPaper: {
                    title: bestMatch.title,
                    year: bestMatch.year,
                    url: bestMatch.url,
                    database: bestMatch.database,
                },
            };
        }

        // Tier 3: Good Match (> 70%) -> Verified High Confidence
        return {
            inlineLocation,
            status: "VERIFIED",
            message: `✅ Verified: "${bestMatch.title}" (${(similarity * 100).toFixed(0)}% match from ${bestMatch.database})`,
            similarity: similarity,
            foundPaper: {
                title: bestMatch.title,
                year: bestMatch.year,
                url: bestMatch.url,
                database: bestMatch.database,
            },
        };
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
