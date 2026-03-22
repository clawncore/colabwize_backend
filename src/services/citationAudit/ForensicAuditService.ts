import { ExternalVerificationService } from "./externalVerification";
import {
  VerificationResult,
  AuditReport,
  CitationFlag,
  AuditTier,
  AuditResponse,
} from "../../types/citationAudit";
import { SemanticClaimService } from "./semanticClaimService";
import logger from "../../monitoring/logger";

export interface SimpleCitationPair {
  inline: {
    text: string;
    start: number;
    end: number;
    patternType: string;
    context?: string;
  };
  reference?: {
    rawText: string;
    index: number;
    extractedAuthor?: string;
    extractedTitle?: string;
    extractedYear?: number;
    extractedDOI?: string;
  } | null;
}

export interface ForensicResult {
  pair: SimpleCitationPair;
  status:
    | "VERIFIED"
    | "SUSPICIOUS"
    | "UNVERIFIED"
    | "UNSUPPORTED"
    | "MISMATCH";
  confidence: number;
  issues: string[];
  evidence?: any;
  alternatives?: any[];
}

export class ForensicAuditService {
  /**
   * Run a full forensic audit on a list of citation pairs
   */
  static async auditCitations(
    pairs: SimpleCitationPair[],
  ): Promise<ForensicResult[]> {
    const results: ForensicResult[] = [];

    // 1. Verify Existence and Basic Metadata
    // Utilize existing logic but interpret strictness higher
    const verificationResults =
      await ExternalVerificationService.verifyCitationPairs(pairs as any);

    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      const ver = verificationResults.find(
        (v: VerificationResult) => v.inlineLocation?.text === pair.inline.text,
      );

      if (!ver) {
        results.push({
          pair,
          status: "SUSPICIOUS",
          confidence: 0,
          issues: ["Internal Verification Error"],
        });
        continue;
      }

      const issues: string[] = [];
      let status: ForensicResult["status"] = "VERIFIED";
      let confidence = 1.0;

      // CHECK 1: Existence (Hallucination Check)
      if (ver.status === "VERIFICATION_FAILED") {
        status = "UNVERIFIED";
        issues.push(
          ver.message || "Paper does not exist in academic databases.",
        );
        confidence = 0.0;
      } else if (ver.status === "INSUFFICIENT_INFO") {
        status = "SUSPICIOUS";
        issues.push(ver.message || "Citation info too sparse to verify.");
        confidence = 0.5;
      }

      // CHECK 2: Authorship Mismatch (Forensic)
      if (ver.foundPaper && pair.reference?.extractedAuthor) {
        // Heuristic: If similarity is low and authors mismatch
        if (ver.similarity && ver.similarity < 0.7) {
          status = "MISMATCH";
          issues.push(`Possible author mismatch or low confidence match.`);
          confidence = 0.8;
        }
      }

      // CHECK 3: Semantic Support
      if (status === "VERIFIED" && ver.semanticSupport) {
        if (ver.semanticSupport.status === "DISPUTED") {
          status = "UNSUPPORTED";
          issues.push(
            ver.semanticSupport.reasoning ||
              "The cited paper appears to contradict your claim.",
          );
          confidence = 0.8;
        } else if (ver.semanticSupport.status === "UNRELATED") {
          status = "UNSUPPORTED";
          issues.push(
            ver.semanticSupport.reasoning ||
              "The cited paper is unrelated to the claim made.",
          );
        }
      }

      results.push({
        pair,
        status,
        confidence,
        issues,
        evidence: ver,
        alternatives: [],
      });
    }

    return results;
  }
}
