import { AcademicDatabaseService } from "../academicDatabaseService";
import {
    VerificationResult,
    ExistenceStatus,
    SupportStatus,
    VerificationProvenance
} from "../../types/citationAudit";
import { CitationPair } from "./citationMatcher";
import logger from "../../monitoring/logger";

/**
 * External Verification Service - Verifies citations using academic databases
 * Now processes CitationPairs with detailed Existence vs Support analysis
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
                    existenceStatus: "SERVICE_ERROR",
                    supportStatus: "NOT_EVALUATED",
                    provenance: [],
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

        const provenance: VerificationProvenance[] = [];

        // Case 1: No matching reference found
        if (!pair.reference) {
            return {
                inlineLocation,
                existenceStatus: "NOT_FOUND",
                supportStatus: "NOT_EVALUATED",
                provenance: [],
                message: `No matching reference found for citation "${pair.inline.text}"`,
            };
        }

        // Case 2: Reference too short to verify
        const wordCount = pair.reference.rawText.trim().split(/\s+/).length;
        if (wordCount <= 5 || !pair.reference.extractedTitle) {
            return {
                inlineLocation,
                existenceStatus: "PENDING", // Partial info
                supportStatus: "NOT_EVALUATED",
                provenance: [],
                message: "Citation lacks title information for automatic verification",
            };
        }

        // Case 3: Verify using academic database
        let foundPaper: any = null;
        let bestMatch: any = null;
        let similarity = 0;

        // B1. Preferred: DOI Search
        if (pair.reference.extractedDOI) {
            const start = Date.now();
            try {
                foundPaper = await AcademicDatabaseService.searchByDOI(pair.reference.extractedDOI);
                provenance.push({
                    source: "CrossRef",
                    status: foundPaper ? "SUCCESS" : "FAILED",
                    latencyMs: Date.now() - start
                });

                if (foundPaper) {
                    bestMatch = { ...foundPaper, similarity: 1.0 };
                }
            } catch (e) {
                provenance.push({ source: "CrossRef", status: "FAILED", latencyMs: Date.now() - start });
            }
        }

        // B2. Fallback: Title/Author Search
        if (!bestMatch) {
            const searchQuery = this.buildSearchQuery(pair.reference);
            const start = Date.now();

            try {
                // Determine source for logging (simplified, usually CrossRef+PubMed+arXiv aggregated)
                const apiResults = await AcademicDatabaseService.searchAcademicDatabases(searchQuery);
                provenance.push({
                    source: "Other", // Wrapper aggregates multiple
                    status: "SUCCESS",
                    latencyMs: Date.now() - start
                });

                if (apiResults.length > 0) {
                    bestMatch = apiResults[0];
                    // If best match is high confidence, we stop.
                    // (Actually we just take the top result for now)
                }
            } catch (e) {
                provenance.push({ source: "Other", status: "FAILED", latencyMs: Date.now() - start });
            }
        }

        // Determine EXISTENCE STATUS
        let existenceStatus: ExistenceStatus = "NOT_FOUND";
        if (bestMatch) {
            similarity = bestMatch.similarity || 0;
            if (bestMatch.isRetracted) {
                // Retracted papers exist, but are dangerous.
                // We confirm existence but flag retraction in message/metadata.
                existenceStatus = "CONFIRMED";
            } else if (similarity > 0.7) {
                existenceStatus = "CONFIRMED";
            } else if (similarity > 0.5) {
                existenceStatus = "CONFIRMED"; // "Likely"
            } else {
                existenceStatus = "NOT_FOUND"; // Low confidence
            }
        }

        // Case 4: Not Found or Low Confidence
        if (existenceStatus === "NOT_FOUND") {
            const refTitle = pair.reference.extractedTitle || pair.reference.rawText.substring(0, 80);
            return {
                inlineLocation,
                existenceStatus: "NOT_FOUND",
                supportStatus: "NOT_EVALUATED",
                provenance,
                message: `Paper not found or poor match. Reference: "${refTitle}".`,
                similarity: similarity,
            };
        }

        // Case 5: Semantic Support Check
        let supportStatus: SupportStatus = "NOT_EVALUATED";
        let semanticAnalysis = undefined;

        if (bestMatch?.abstract && pair.inline.context) {
            try {
                const { SemanticClaimService } = require("./semanticClaimService");
                const analysis = await SemanticClaimService.verifyClaim(pair.inline.context, bestMatch.abstract);

                // Map legacy/new status to SupportStatus
                // Assuming we will fix SemanticClaimService to return exact types, 
                // OR we map strings.
                const rawStatus = analysis.status;
                if (rawStatus === "SUPPORTED") supportStatus = "SUPPORTED";
                else if (rawStatus === "PARTIALLY_SUPPORTED") supportStatus = "PLAUSIBLE";
                else if (rawStatus === "DISPUTED") supportStatus = "CONTRADICTORY";
                else if (rawStatus === "UNRELATED") supportStatus = "UNRELATED";
                else supportStatus = "PLAUSIBLE"; // Default if unclear

                semanticAnalysis = {
                    reasoning: analysis.reasoning,
                    confidence: analysis.confidence || 0.8
                };
            } catch (e) {
                logger.error("Semantic check failed", { error: e });
            }
        }

        // Construct Final Message
        let message = `Found: "${bestMatch.title}"`;
        if (bestMatch.isRetracted) message = `🚨 RETRACTED SOURCE: ${bestMatch.title}`;
        else if (supportStatus === "CONTRADICTORY") message = `⚠️ Paper disputes claim: "${bestMatch.title}"`;
        else if (supportStatus === "UNRELATED") message = `⚠️ Paper may be unrelated: "${bestMatch.title}"`;

        return {
            inlineLocation,
            existenceStatus,
            supportStatus,
            provenance,
            message,
            similarity,
            foundPaper: {
                title: bestMatch.title,
                authors: bestMatch.authors,
                year: bestMatch.year,
                url: bestMatch.url,
                doi: bestMatch.doi,
                database: bestMatch.database,
                abstract: bestMatch.abstract,
                isRetracted: bestMatch.isRetracted
            },
            semanticAnalysis
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
