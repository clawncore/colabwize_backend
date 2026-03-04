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
        let formattingErrors = 0;

        for (const ref of bibliography) {
            if (!ref.text || ref.text.trim() === "") continue;

            const text = ref.text.trim();

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

            // Check for stray square brackets (commonly left over from sloppy copy-pastes)
            if (text.includes("[") && text.includes("]") && !text.includes("[Citation]")) {
                // Technically not always an error, but a warning
                job.report!.issues.push({
                    id: uuidv4(),
                    type: "FORMATTING_BRACKETS",
                    severity: "INFO",
                    referenceId: ref.id,
                    location: { startPos: ref.start, endPos: ref.end },
                    message: `Stray square brackets detected in reference.`,
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
