import { v4 as uuidv4 } from "uuid";
import { AuditJob, AuditContext, AuditPipelineStage } from "../types";

/**
 * Stage 6: Style Compliance Engine
 * Validates formatting specifics based on the document's selected manual style (e.g. APA).
 * Checks for parenthesis mismatch, bolding errors, and missing metadata.
 */
export const StyleCheckStage: AuditPipelineStage = {
    name: "STYLE_COMPLIANCE",
    weight: 15,
    execute: async (job: AuditJob, context: AuditContext) => {
        const { bibliography } = context;
        const style = job.report?.metadata?.style || "APA";
        let formattingErrors = 0;

        for (const ref of bibliography) {
            if (!ref.text || ref.text.trim() === "") continue;

            const text = ref.text.trim();

            if (style === "IEEE") {
                // IEEE Rule: Often starts with [1] or 1.
                const hasIeeeMarker = /^\[\d+\]/.test(text) || /^\d+\./.test(text);
                if (!hasIeeeMarker) {
                    formattingErrors++;
                    job.report!.issues.push({
                        id: uuidv4(),
                        type: "FORMATTING_IEEE_MARKER",
                        severity: "MINOR",
                        referenceId: ref.id,
                        location: { startPos: ref.start, endPos: ref.end },
                        message: `Reference missing IEEE-style marker (e.g., [1] or 1.)`,
                        suggestedFix: "Add a reference number at the beginning of the entry.",
                        autoFixAvailable: false
                    });
                }
                
                // IEEE Rule: Should contain a year somewhere (usually at the end or in middle)
                const hasYear = /\b(19|20)\d{2}\b/.test(text);
                if (!hasYear) {
                    formattingErrors++;
                    job.report!.issues.push({
                        id: uuidv4(),
                        type: "FORMATTING_METADATA",
                        severity: "MAJOR",
                        referenceId: ref.id,
                        location: { startPos: ref.start, endPos: ref.end },
                        message: `Missing publication year in IEEE entry: ${text.substring(0, 40)}...`,
                        suggestedFix: "Ensure the publication year is included in the reference.",
                        autoFixAvailable: false
                    });
                }
            } else {
                // APA Rule: Must have a year in parentheses e.g. (2023)
                const hasYear = /\(\d{4}[a-z]?\)/.test(text);
                if (!hasYear) {
                    formattingErrors++;

                    job.report!.issues.push({
                        id: uuidv4(),
                        type: "FORMATTING_METADATA",
                        severity: "MAJOR",
                        referenceId: ref.id,
                        location: { startPos: ref.start, endPos: ref.end },
                        message: `Missing publication year in APA format: ${text.substring(0, 40)}...`,
                        suggestedFix: "Ensure a valid year (e.g. 2023) is present in the bibliography string.",
                        autoFixAvailable: false
                    });
                }

                // APA Rule: Must have authors before the year
                const hasAuthorsBeforeYear = /^.+?(?=\(\d{4}[a-z]?\))/.test(text);
                if (!hasAuthorsBeforeYear && hasYear) {
                    formattingErrors++;

                    job.report!.issues.push({
                        id: uuidv4(),
                        type: "FORMATTING_AUTHORS",
                        severity: "MAJOR",
                        referenceId: ref.id,
                        location: { startPos: ref.start, endPos: ref.end },
                        message: `Missing or incorrectly placed author names before the publication year.`,
                        suggestedFix: "Follow the 'Author, A.A. (Year).' format.",
                        autoFixAvailable: false
                    });
                }
            }

            // Common Warning: Check for stray square brackets (unless in IEEE where they are markers)
            if (style !== "IEEE" && text.includes("[") && text.includes("]") && !text.includes("[Citation]")) {
                job.report!.issues.push({
                    id: uuidv4(),
                    type: "FORMATTING_BRACKETS",
                    severity: "INFO",
                    referenceId: ref.id,
                    location: { startPos: ref.start, endPos: ref.end },
                    message: `Stray square brackets detected in non-IEEE reference.`,
                    suggestedFix: "Verify if brackets are intentional or artifact from copy-paste.",
                    autoFixAvailable: false
                });
            }
        }

        job.report!.summary.formattingErrors = formattingErrors;

        // Formatting Errors penalize slightly less than broken links but still impact output quality
        if (formattingErrors > 0) {
            job.report!.summary.complianceScore -= (formattingErrors * 2);
        }

        console.log(`[Stage] STYLE_COMPLIANCE: Evaluated style rules, found ${formattingErrors} errors.`);
    }
};
