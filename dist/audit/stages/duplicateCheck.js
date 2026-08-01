"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DuplicateCheckStage = void 0;
const uuid_1 = require("uuid");
const string_similarity_1 = __importDefault(require("string-similarity")); // For fuzzy title matching
/**
 * Stage 4: Duplicate Detection
 * Detects if the bibliography contains duplicated references.
 */
exports.DuplicateCheckStage = {
    name: "DUPLICATE_DETECTION",
    weight: 20,
    execute: async (job, context) => {
        const { bibliography } = context;
        const processedIndices = new Set();
        let duplicatesDetected = 0;
        for (let i = 0; i < bibliography.length; i++) {
            if (processedIndices.has(i))
                continue;
            const refA = bibliography[i];
            const refAId = refA.id || refA.text.substring(0, 20);
            const cluster = [refAId];
            let matchReason = "";
            let confidence = 1.0;
            for (let j = i + 1; j < bibliography.length; j++) {
                if (processedIndices.has(j))
                    continue;
                const refB = bibliography[j];
                const refBId = refB.id || refB.text.substring(0, 20);
                // Exact DOI Match
                if (refA.doi && refB.doi && refA.doi.trim() === refB.doi.trim()) {
                    cluster.push(refBId);
                    processedIndices.add(j);
                    matchReason = "Exact DOI Match";
                    confidence = 1.0;
                }
                // URL Match
                else if (refA.url && refB.url && refA.url.trim() === refB.url.trim()) {
                    cluster.push(refBId);
                    processedIndices.add(j);
                    matchReason = "Exact URL Match";
                    confidence = 1.0;
                }
                // Fuzzy Title/Text Match
                else if (refA.text.length > 20 && refB.text.length > 20) {
                    const similarity = string_similarity_1.default.compareTwoStrings(refA.text, refB.text);
                    if (similarity > 0.90) { // High threshold for bibliography entries
                        cluster.push(refBId);
                        processedIndices.add(j);
                        matchReason = "Fuzzy Text Match";
                        confidence = similarity;
                    }
                }
            }
            if (cluster.length > 1) {
                duplicatesDetected += (cluster.length - 1);
                job.report.duplicates.push({
                    duplicateGroupId: `DUP_${(0, uuid_1.v4)().substring(0, 8)}`,
                    references: cluster,
                    matchReason,
                    confidence,
                    recommendedPrimary: cluster[0] // Simply pick the first one chronologically
                });
                job.report.issues.push({
                    id: (0, uuid_1.v4)(),
                    type: "DUPLICATE_REFERENCE",
                    severity: "MAJOR",
                    referenceId: cluster[1],
                    location: { startPos: bibliography.find(b => b.id === cluster[1])?.start },
                    message: `This bibliography entry appears to be a duplicate of ${cluster[0]}. Reason: ${matchReason}`,
                    suggestedFix: "Merge citations to point to the primary reference and delete this duplicate.",
                    autoFixAvailable: true
                });
            }
        }
        job.report.summary.duplicatesDetected = duplicatesDetected;
        // Note: Score penalties for duplicates are already accounted for in VerificationStage's
        // scoreBreakdown. We only add issues here for the UI — no direct complianceScore
        // mutation to avoid double-counting.
        console.log(`[Stage] DUPLICATE_DETECTION: Scanned ${bibliography.length} entries, found ${duplicatesDetected} duplicates.`);
    }
};
