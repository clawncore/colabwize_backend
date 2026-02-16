import { ExternalVerificationService } from "./externalVerification";
import { CitationPair } from "./citationMatcher";
import { VerificationResult, AuditResponse, CitationFlag, AuditTier } from "../../types/citationAudit";
import { SemanticClaimService } from "./semanticClaimService";
import logger from "../../monitoring/logger";

export interface ForensicResult {
    pair: CitationPair;
    status: "VERIFIED" | "SUSPICIOUS" | "HALLUCINATION" | "UNSUPPORTED" | "MISMATCH";
    confidence: number;
    issues: string[];
    evidence?: any;
    alternatives?: any[];
}

export class ForensicAuditService {

    /**
     * Run a full forensic audit on a list of citation pairs
     */
    static async auditCitations(pairs: CitationPair[]): Promise<ForensicResult[]> {
        const results: ForensicResult[] = [];

        // 1. Verify Existence and Basic Metadata
        // Utilize existing logic but interpret strictness higher
        const verificationResults = await ExternalVerificationService.verifyCitationPairs(pairs);

        for (let i = 0; i < pairs.length; i++) {
            const pair = pairs[i];
            const ver = verificationResults.find(v => v.inlineLocation?.text === pair.inline.text); // naive match or use index

            if (!ver) {
                results.push({
                    pair,
                    status: "SUSPICIOUS",
                    confidence: 0,
                    issues: ["Internal Verification Error"]
                });
                continue;
            }

            const issues: string[] = [];
            let status: ForensicResult["status"] = "VERIFIED";
            let confidence = 1.0;

            // CHECK 1: Existence (Hallucination Check)
            if (ver.existenceStatus === "NOT_FOUND") {
                status = "HALLUCINATION";
                issues.push("Paper does not exist in academic databases (CrossRef/Semantic Scholar).");
                confidence = 0.0;
            } else if (ver.existenceStatus === "PENDING") {
                status = "SUSPICIOUS";
                issues.push("Citation info too sparse to verify.");
                confidence = 0.5;
            }

            // CHECK 2: Authorship Mismatch (Forensic)
            // If we found a paper, does the author match interpretation?
            if (ver.foundPaper && pair.reference?.extractedAuthor) {
                const authors = ver.foundPaper.authors || [];
                const realAuthors = authors.map((a: string) => a.toLowerCase()).join(" ");
                const citedAuthor = pair.reference.extractedAuthor.toLowerCase();

                // Simple inclusion check
                // Check if cited identifier (e.g. "Smith") is in the real author list
                const keywords = citedAuthor.split(/[\s,]+/);
                const match = keywords.some(k => realAuthors.includes(k) && k.length > 2);

                if (!match) {
                    status = "MISMATCH";
                    issues.push(`Author mismatch. Cited: "${pair.reference.extractedAuthor}", Real: "${authors.slice(0, 3).join(", ")}..."`);
                    confidence = 0.8; // We are confident it IS a mismatch
                }
            }

            // CHECK 3: Semantic Support
            if (status === "VERIFIED" && ver.supportStatus === "CONTRADICTORY") {
                status = "UNSUPPORTED";
                issues.push("The cited paper appears to contradict your claim.");
                confidence = ver.semanticAnalysis?.confidence || 0.8;
            } else if (status === "VERIFIED" && ver.supportStatus === "UNRELATED") {
                // Determine if this is a "claim" citation or just a general ref?
                // Logic already inside verifyCitationPairs
                status = "UNSUPPORTED";
                issues.push("The cited paper is unrelated to the claim made.");
            }

            results.push({
                pair,
                status,
                confidence,
                issues,
                evidence: ver,
                alternatives: [] // Could populate from search
            });
        }

        return results;
    }
}
