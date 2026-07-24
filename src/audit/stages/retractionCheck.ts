import { v4 as uuidv4 } from "uuid";
import { AuditJob, AuditContext, AuditPipelineStage, AuditIssue } from "../types";
import { RetractionWatchService, RetractionInfo } from "../../services/retractionWatchService";
import { VerificationResult } from "../../types/citationAudit";

interface RetractionFlag {
  doi: string;
  info: RetractionInfo;
  referenceText: string;
  referenceIndex: number;
}

/**
 * Stage: Retraction Check
 *
 * Runs after DB_VERIFICATION. Iterates over all verified citation results
 * and checks each reference's DOI against Retraction Watch data sources.
 *
 * Adds retraction-specific issues to the audit report:
 *   - CRITICAL: Retracted paper cited
 *   - MAJOR: Expression of concern exists
 *   - MINOR: Correction/erratum issued
 *   - INFO: Hijacked journal detected
 */
export const RetractionCheckStage: AuditPipelineStage = {
  name: "RETRACTION_CHECK",
  weight: 10,
  execute: async (job: AuditJob, context: AuditContext) => {
    const verificationResults: VerificationResult[] =
      (job.report?.verificationResults as VerificationResult[]) ?? [];

    const dois: string[] = [];

    for (const result of verificationResults) {
      if (!result.foundPaper) continue;

      if (result.foundPaper.isRetracted) {
        const knownRetraction: RetractionFlag = {
          doi: "",
          info: {
            isRetracted: true,
            hasExpressionOfConcern: false,
            hasCorrection: false,
            isHijacked: false,
            source: "crossref",
            title: result.foundPaper.title,
          },
          referenceText: result.inlineLocation.text,
          referenceIndex: result.referenceIndex ?? -1,
        };
        addRetractionIssue(job, knownRetraction);
        continue;
      }

      const doi = extractDOIFromResult(result);
      if (doi) dois.push(doi);
    }

    const retractionResults = await RetractionWatchService.checkDOIs(dois);
    const flags: RetractionFlag[] = [];

    for (let i = 0; i < verificationResults.length; i++) {
      const result = verificationResults[i];
      const doi = extractDOIFromResult(result);
      if (!doi) continue;

      const info = retractionResults.get(doi);
      if (!info) continue;

      flags.push({
        doi,
        info,
        referenceText: result.inlineLocation.text,
        referenceIndex: result.referenceIndex ?? i,
      });
    }

    for (const flag of flags) {
      addRetractionIssue(job, flag);

      if (flag.info.isHijacked) {
        job.report!.issues.push({
          id: uuidv4(),
          category: "VERIFICATION",
          type: "HIJACKED_JOURNAL",
          severity: "MAJOR",
          referenceId: `ref-${flag.referenceIndex}`,
          location: { startPos: flag.referenceIndex },
          message: `The journal of "${flag.info.title || flag.referenceText}" may be a hijacked or predatory publication.`,
          suggestedFix: "Verify the journal's legitimate website and ISSN. Use DOAJ or official journal site.",
          autoFixAvailable: false,
        });
      }
    }

    console.log(
      `[Stage] RETRACTION_CHECK: Checked ${dois.length} DOIs, found ${flags.length} with retraction notices.`
    );
  },
};

function extractDOIFromResult(result: VerificationResult): string | null {
  if (result.foundPaper?.title) {
    const doiMatch = result.foundPaper.title.match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i);
    if (doiMatch) return doiMatch[0];
  }

  const textMatch = result.inlineLocation.text.match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i);
  if (textMatch) return textMatch[0];

  return null;
}

function addRetractionIssue(job: AuditJob, flag: RetractionFlag): void {
  const info = flag.info;

  if (info.isRetracted) {
    const issue: AuditIssue = {
      id: uuidv4(),
      category: "VERIFICATION",
      type: "RETRACTED_REFERENCE",
      severity: "CRITICAL",
      referenceId: `ref-${flag.referenceIndex}`,
      location: { startPos: flag.referenceIndex },
      message: info.retractionDOI
        ? `🚨 Retracted source: "${info.title || flag.referenceText}". See retraction notice: https://doi.org/${info.retractionDOI}`
        : `🚨 Retracted source detected: "${info.title || flag.referenceText}". This paper has been retracted and should not be cited.`,
      suggestedFix: "Replace with a non-retracted source or cite with explicit retraction acknowledgement.",
      autoFixAvailable: false,
    };
    job.report!.issues.push(issue);
  }

  if (info.hasExpressionOfConcern) {
    const issue: AuditIssue = {
      id: uuidv4(),
      category: "VERIFICATION",
      type: "EXPRESSION_OF_CONCERN",
      severity: "MAJOR",
      referenceId: `ref-${flag.referenceIndex}`,
      location: { startPos: flag.referenceIndex },
      message: `Expression of Concern exists for "${info.title || flag.referenceText}". The reliability of this source is under review.`,
      suggestedFix: "Verify the current status of this paper before citing. Consider alternatives.",
      autoFixAvailable: false,
    };
    job.report!.issues.push(issue);
  }

  if (info.hasCorrection) {
    const issue: AuditIssue = {
      id: uuidv4(),
      category: "VERIFICATION",
      type: "CORRECTION_ISSUED",
      severity: "MINOR",
      referenceId: `ref-${flag.referenceIndex}`,
      location: { startPos: flag.referenceIndex },
      message: `A correction/erratum has been issued for "${info.title || flag.referenceText}". Ensure you are citing the corrected version.`,
      suggestedFix: info.correctionDOI
        ? `Check the corrected version at: https://doi.org/${info.correctionDOI}`
        : "Check the publisher's website for the corrected version.",
      autoFixAvailable: false,
    };
    job.report!.issues.push(issue);
  }
}
