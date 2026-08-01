"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MapStage = void 0;
const uuid_1 = require("uuid");
/**
 * Stage 2: Cross-Reference Mapping
 * Ensures every in-text citation maps to a bibliography entry,
 * and every bibliography entry has at least one in-text citation.
 */
exports.MapStage = {
    name: "CROSS_REFERENCE_MAPPING",
    weight: 20,
    execute: async (job, context) => {
        const { citations, bibliography, citationIdMap } = context;
        // Build fast lookup map for Bibliography entries
        const refMap = new Map();
        bibliography.forEach(ref => {
            if (ref.id)
                refMap.set(ref.id, ref);
            // Fallback: match by raw text snippet
            refMap.set(ref.text.substring(0, 30), ref);
        });
        // Build fast lookup map for Citations
        const citMap = new Map();
        citations.forEach(cit => {
            if (cit.citationId)
                citMap.set(cit.citationId, true);
        });
        let brokenCitations = 0;
        let uncitedReferences = 0;
        // 1. Check for Broken Citations (No matching Ref)
        for (const cit of citations) {
            if (!cit.citationId)
                continue;
            const hasRef = refMap.has(cit.citationId);
            if (!hasRef) {
                brokenCitations++;
                job.report.issues.push({
                    id: (0, uuid_1.v4)(),
                    type: "BROKEN_REFERENCE",
                    severity: "CRITICAL",
                    referenceId: cit.citationId,
                    location: { startPos: cit.start, endPos: cit.end },
                    message: `In-text citation '${cit.text}' does not match any entry in the bibliography.`,
                    suggestedFix: "Add the full reference to the bibliography section.",
                    autoFixAvailable: false
                });
            }
        }
        // 2. Check for Orphaned References (No matching Citation)
        for (const ref of bibliography) {
            if (!ref.id)
                continue;
            const hasCit = citMap.has(ref.id);
            if (!hasCit) {
                uncitedReferences++;
                job.report.issues.push({
                    id: (0, uuid_1.v4)(),
                    type: "UNCITED_REFERENCE",
                    severity: "MINOR", // Typically cosmetic, doesn't break export usually
                    referenceId: ref.id,
                    location: { startPos: ref.start, endPos: ref.end },
                    message: `Bibliography entry '${ref.text.substring(0, 40)}...' is never cited in the document.`,
                    suggestedFix: "Remove the unused entry from the bibliography.",
                    autoFixAvailable: true
                });
            }
        }
        // Store in context for faster access downstream
        context.citationIdMap = refMap;
        // Update Metrics
        job.report.summary.brokenCitations = brokenCitations;
        job.report.summary.uncitedReferences = uncitedReferences;
        // Strict penalty for broken references
        if (brokenCitations > 0) {
            job.report.summary.complianceScore -= (brokenCitations * 15);
        }
        // Minor penalty for orphans
        if (uncitedReferences > 0) {
            job.report.summary.complianceScore -= (uncitedReferences * 2);
        }
        console.log(`[Stage] MAPPING: Found ${brokenCitations} broken, ${uncitedReferences} orphaned.`);
    }
};
