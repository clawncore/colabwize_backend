import { AuditJob, AuditContext, AuditPipelineStage } from "../types";
import { CitationRoleClassifier } from "../../services/citationRoleClassifier";

interface CitationRoleEntry {
  citationText: string;
  role: CitationRole;
  confidence: number;
  matchedPattern?: string;
}

/**
 * Stage: Citation Role Classification
 *
 * Analyzes each citation's context to determine its role in the document:
 *   FOUNDATIONAL, DATA_SOURCE, METHODOLOGICAL, CONTEXTUAL,
 *   NARRATIVE, SECONDARY, SUPPORTING, or UNKNOWN.
 *
 * Pure pattern-based classification — no AI required.
 * Results are stored in job.report for frontend display.
 */
export const CitationRoleStage: AuditPipelineStage = {
  name: "CITATION_ROLE",
  weight: 5,
  execute: async (job: AuditJob, context: AuditContext) => {
    const { citations } = context;

    if (citations.length === 0) {
      console.log("[Stage] CITATION_ROLE: No citations to classify.");
      return;
    }

    const classifiedEntries: CitationRoleEntry[] = [];

    for (const citation of citations) {
      const fullText = citation.text;

      const result = CitationRoleClassifier.classify(fullText, fullText);

      classifiedEntries.push({
        citationText: citation.text,
        role: result.role,
        confidence: result.confidence,
        matchedPattern: result.matchedPattern,
      });
    }

    const roleSummary = CitationRoleClassifier.summarize(
      classifiedEntries.map((e) => ({ text: e.citationText, context: e.citationText }))
    );

    (job.report as any).citationRoles = classifiedEntries;
    (job.report as any).roleSummary = roleSummary;

    const knownRoles = classifiedEntries.filter((e) => e.role !== "UNKNOWN");
    console.log(
      `[Stage] CITATION_ROLE: Classified ${classifiedEntries.length} citations ` +
      `(${knownRoles.length} with identified roles). ` +
      `Top role: ${getTopRole(roleSummary)}`
    );
  },
};

function getTopRole(summary: Record<string, number>): string {
  let top = "UNKNOWN";
  let max = 0;
  for (const [role, count] of Object.entries(summary)) {
    if (count > max) {
      max = count;
      top = role;
    }
  }
  return `${top} (${max})`;
}
