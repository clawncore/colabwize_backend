import express, { Request, Response } from "express";
import { ForensicAuditService, SimpleCitationPair } from "../../services/citationAudit/ForensicAuditService";
import logger from "../../monitoring/logger";
import { authenticateExpressRequest as authenticate } from "../../middleware/auth";
import { checkProjectAccess } from "../../lib/auth-helpers";
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

        const userId = (req as any).user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, error: "Authentication required" });
        }

        const hasAccess = await checkProjectAccess(projectId as string, userId);
        if (!hasAccess) {
            return res.status(403).json({ success: false, error: "Access denied" });
        }

        logger.info(`Starting forensic audit for ${pairs.length} pairs`, { projectId });

        const forensicResults = await ForensicAuditService.auditCitations(pairs as SimpleCitationPair[]);

        const flags: CitationFlag[] = [];
        const verificationResults: VerificationResult[] = [];

        const issues: any[] = forensicResults.filter(r => r.status !== "VERIFIED").map(r => ({
            id: require("uuid").v4(),
            type: "VERIFICATION",
            severity: (r.status === "UNVERIFIED" || r.status === "MISMATCH") ? "CRITICAL" : "MAJOR",
            message: r.issues.join(". "),
            location: {
                startPos: r.pair.inline.start,
                endPos: r.pair.inline.end
            },
            suggestedFix: "Verify this source manually or find a replacement."
        }));

        const report: AuditReport = {
            style: "APA", // Default, could be dynamic
            timestamp: new Date().toISOString(),
            flags: flags,
            issues: issues,
            verificationResults: forensicResults.map(r => r.evidence).filter(Boolean),
            summary: {
                totalInTextCitations: pairs.length,
                uniqueBibliographyEntries: 0,
                brokenCitations: issues.length,
                uncitedReferences: 0,
                duplicatesDetected: 0,
                invalidUrls: 0,
                complianceScore: 100
            },
            tierMetadata: {
                CLAIM: { stats: { candidates: pairs.length } }
            }
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
