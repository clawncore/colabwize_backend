"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CitationRoleStage = void 0;
const citationRoleClassifier_1 = require("../../services/citationRoleClassifier");
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
exports.CitationRoleStage = {
    name: "CITATION_ROLE",
    weight: 5,
    execute: async (job, context) => {
        const { citations } = context;
        if (citations.length === 0) {
            console.log("[Stage] CITATION_ROLE: No citations to classify.");
            return;
        }
        const classifiedEntries = [];
        for (const citation of citations) {
            const fullText = citation.text;
            const result = citationRoleClassifier_1.CitationRoleClassifier.classify(fullText, fullText);
            classifiedEntries.push({
                citationText: citation.text,
                role: result.role,
                confidence: result.confidence,
                matchedPattern: result.matchedPattern,
            });
        }
        // Build ClassifiedCitation[] required by summarize()
        const classifiedForSummary = classifiedEntries.map((e) => ({
            text: e.citationText,
            role: e.role,
            confidence: e.confidence,
            matchedPattern: e.matchedPattern,
        }));
        const roleSummary = citationRoleClassifier_1.CitationRoleClassifier.summarize(classifiedForSummary);
        job.report.citationRoles = classifiedEntries;
        job.report.roleSummary = roleSummary;
        const knownRoles = classifiedEntries.filter((e) => e.role !== "UNKNOWN");
        console.log(`[Stage] CITATION_ROLE: Classified ${classifiedEntries.length} citations ` +
            `(${knownRoles.length} with identified roles). ` +
            `Top role: ${getTopRole(roleSummary)}`);
    },
};
function getTopRole(summary) {
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
