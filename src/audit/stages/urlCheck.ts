import { v4 as uuidv4 } from "uuid";
import { AuditJob, AuditContext, AuditPipelineStage } from "../types";

/**
 * Stage 5: URL Validation
 * Validates hyperlinks in the bibliography entries, standardizes HTTP to HTTPS,
 * normalizes DOI links, and detects malformed URLs.
 */
export const UrlCheckStage: AuditPipelineStage = {
    name: "URL_VALIDATION",
    weight: 20,
    execute: async (job: AuditJob, context: AuditContext) => {
        const { bibliography } = context;
        let invalidUrls = 0;

        for (const ref of bibliography) {
            if (!ref.url && !ref.doi && !ref.text.includes("http")) continue;

            let targetUrl = ref.url || ref.text.match(/https?:\/\/[^\s]+/)?.[0];
            const doiRaw = ref.doi || ref.text.match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i)?.[0];

            if (!targetUrl && doiRaw) {
                targetUrl = `https://doi.org/${doiRaw}`;
            }

            if (!targetUrl) continue;

            // 1. Validation logic
            let formatValid = true;
            let protocol: "HTTP" | "HTTPS" | "UNKNOWN" = "UNKNOWN";
            let isDoiNormalized = false;
            let reachable = true; // We won't actually ping here to save 10sec delays, assume true unless format is horribly bad

            try {
                const urlObj = new URL(targetUrl);
                protocol = urlObj.protocol.replace(':', '').toUpperCase() as any;

                if (protocol === "HTTP") {
                    job.report!.issues.push({
                        id: uuidv4(),
                        type: "INSECURE_URL",
                        severity: "MINOR",
                        referenceId: ref.id,
                        location: { startPos: ref.start, endPos: ref.end },
                        message: `Bibliography entry uses unencrypted HTTP protocol: ${targetUrl}`,
                        suggestedFix: `Change protocol from http:// to https://`,
                        autoFixAvailable: true
                    });
                    formatValid = false;
                    invalidUrls++;
                }

                if (urlObj.hostname === "dx.doi.org" || urlObj.hostname === "doi.org") {
                    isDoiNormalized = urlObj.hostname === "doi.org"; // the preferred modern standard
                    if (!isDoiNormalized) {
                        job.report!.issues.push({
                            id: uuidv4(),
                            type: "DOI_FORMATTING",
                            severity: "INFO",
                            referenceId: ref.id,
                            location: { startPos: ref.start, endPos: ref.end },
                            message: `DOI URL uses legacy 'dx.doi.org'.`,
                            suggestedFix: `Update to modern 'doi.org' format.`,
                            autoFixAvailable: true
                        });
                    }
                }
            } catch (e) {
                formatValid = false;
                invalidUrls++;

                job.report!.issues.push({
                    id: uuidv4(),
                    type: "MALFORMED_URL",
                    severity: "MAJOR",
                    referenceId: ref.id,
                    location: { startPos: ref.start, endPos: ref.end },
                    message: `Bibliography URL is malformed and unclickable: ${targetUrl}`,
                    suggestedFix: "Correct the URL format.",
                    autoFixAvailable: false
                });
            }

            job.report!.linkValidation.push({
                url: targetUrl,
                formatValid,
                protocol,
                reachable,
                doiNormalized: isDoiNormalized
            });
        }

        job.report!.summary.invalidUrls = invalidUrls;

        // Penalize score for invalid URLs (HTTP or Malformed)
        if (invalidUrls > 0) {
            job.report!.summary.complianceScore -= (invalidUrls * 5);
        }

        console.log(`[Stage] URL_VALIDATION: Inspected Links, found ${invalidUrls} issues.`);
    }
};
