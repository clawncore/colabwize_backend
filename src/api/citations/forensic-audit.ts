import express, { Request, Response } from "express";
import { ForensicAuditService, SimpleCitationPair } from "../../services/citationAudit/ForensicAuditService";
import logger from "../../monitoring/logger";
import { authenticateExpressRequest as authenticate } from "../../middleware/auth";
import { CitationFlag, VerificationResult, AuditReport } from "../../types/citationAudit";

const router = express.Router();

/**
 * POST /api/citations/forensic-audit
 * Run a full forensic audit on a list of citation pairs
 */
router.post("/forensic-audit", authenticate, async (req: Request, res: Response) => {
    try {
        const { pairs, projectId } = req.body;

        if (!pairs || !Array.isArray(pairs)) {
            return res.status(400).json({
                success: false,
                error: "Pairs array is required"
            });
        }

        logger.info(`Starting forensic audit for ${pairs.length} pairs`, { projectId });

        const forensicResults = await ForensicAuditService.auditCitations(pairs as SimpleCitationPair[]);

        const flags: CitationFlag[] = [];
        const verificationResults: VerificationResult[] = [];

        forensicResults.forEach(r => {
            // 1. Create Flags for anything not VERIFIED
            if (r.status !== "VERIFIED") {
                flags.push({
                    type: "VERIFICATION",
                    ruleId: `FORENSIC_${r.status}`,
                    message: r.issues.join(". "),
                    anchor: {
                        start: r.pair.inline.start,
                        end: r.pair.inline.end,
                        text: r.pair.inline.text
                    }
                });
            }

            // 2. Create Verification Results for all
            let vStatus: VerificationResult["status"] = "VERIFIED";
            if (r.status === "HALLUCINATION" || r.status === "MISMATCH") {
                vStatus = "VERIFICATION_FAILED";
            } else if (r.status === "SUSPICIOUS") {
                vStatus = "INSUFFICIENT_INFO";
            }

            verificationResults.push({
                inlineLocation: {
                    start: r.pair.inline.start,
                    end: r.pair.inline.end,
                    text: r.pair.inline.text
                },
                status: vStatus,
                message: r.issues.join(". ") || "Verified by Forensic Engine",
                foundPaper: r.evidence?.foundPaper
            });
        });

        const report: AuditReport = {
            style: "APA", // Default, could be dynamic
            timestamp: new Date().toISOString(),
            flags: flags,
            verificationResults: verificationResults
        };

        return res.status(200).json(report);

    } catch (error: any) {
        logger.error("Error in forensic audit", {
            error: error.message,
            stack: error.stack,
        });

        return res.status(500).json({
            success: false,
            error: error.message || "Forensic audit failed",
        });
    }
});

export default router;
