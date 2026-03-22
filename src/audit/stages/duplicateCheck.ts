import { v4 as uuidv4 } from "uuid";
import { AuditJob, AuditContext, AuditPipelineStage } from "../types";
import stringSimilarity from "string-similarity"; // For fuzzy title matching

/**
 * Stage 4: Duplicate Detection
 * Detects if the bibliography contains duplicated references.
 */
export const DuplicateCheckStage: AuditPipelineStage = {
    name: "DUPLICATE_DETECTION",
    weight: 20,
    execute: async (job: AuditJob, context: AuditContext) => {
        const { bibliography } = context;
        const processedIndices = new Set<number>();
        let duplicatesDetected = 0;

        for (let i = 0; i < bibliography.length; i++) {
            if (processedIndices.has(i)) continue;

            const refA = bibliography[i];
            const cluster: string[] = [refA.id];
            let matchReason = "";
            let confidence = 1.0;

            for (let j = i + 1; j < bibliography.length; j++) {
                if (processedIndices.has(j)) continue;

                const refB = bibliography[j];

                // Exact DOI Match
                if (refA.doi && refB.doi && refA.doi.trim() === refB.doi.trim()) {
                    cluster.push(refB.id);
                    processedIndices.add(j);
                    matchReason = "Exact DOI Match";
                    confidence = 1.0;
                }
                // URL Match
                else if (refA.url && refB.url && refA.url.trim() === refB.url.trim()) {
                    cluster.push(refB.id);
                    processedIndices.add(j);
                    matchReason = "Exact URL Match";
                    confidence = 1.0;
                }
                // Fuzzy Title/Text Match
                else if (refA.text.length > 20 && refB.text.length > 20) {
                    const similarity = stringSimilarity.compareTwoStrings(refA.text, refB.text);
                    if (similarity > 0.90) { // High threshold for bibliography entries
                        cluster.push(refB.id);
                        processedIndices.add(j);
                        matchReason = "Fuzzy Text Match";
                        confidence = similarity;
                    }
                }
            }

            if (cluster.length > 1) {
                duplicatesDetected += (cluster.length - 1);
                job.report!.duplicates.push({
                    duplicateGroupId: `DUP_${uuidv4().substring(0, 8)}`,
                    references: cluster,
                    matchReason,
                    confidence,
                    recommendedPrimary: cluster[0] // Simply pick the first one chronologically
                });

                job.report!.issues.push({
                    id: uuidv4(),
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

        job.report!.summary.duplicatesDetected = duplicatesDetected;

        // Duplicates are penalizing because they clutter the document and break export logic optionally
        if (duplicatesDetected > 0) {
            job.report!.summary.complianceScore -= (duplicatesDetected * 8);
        }

        console.log(`[Stage] DUPLICATE_DETECTION: Scanned ${bibliography.length} entries, found ${duplicatesDetected} duplicates.`);
    }
};
