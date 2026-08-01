"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const ForensicAuditService_1 = require("../../services/citationAudit/ForensicAuditService");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const auth_1 = require("../../middleware/auth");
const auth_helpers_1 = require("../../lib/auth-helpers");
const BillingGateway_1 = require("../../billing/BillingGateway");
const router = express_1.default.Router();
/**
 * POST /api/citations/forensic-audit
 * Run a full forensic audit on a list of citation pairs
 */
router.post("/forensic-audit", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const { pairs, projectId } = req.body;
        if (!pairs || !Array.isArray(pairs)) {
            return res.status(400).json({
                success: false,
                error: "Pairs array is required"
            });
        }
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, error: "Authentication required" });
        }
        const hasAccess = await (0, auth_helpers_1.checkProjectAccess)(projectId, userId);
        if (!hasAccess) {
            return res.status(403).json({ success: false, error: "Access denied" });
        }
        logger_1.default.info(`Starting forensic audit for ${pairs.length} pairs`, { projectId });
        // Run through the single billing pipeline (hold → execute → confirm/release).
        try {
            const forensicResults = await BillingGateway_1.BillingGateway.withFeature(userId, "citation_audit", undefined, () => ForensicAuditService_1.ForensicAuditService.auditCitations(pairs));
            const flags = [];
            const verificationResults = [];
            const issues = forensicResults.filter(r => r.status !== "VERIFIED").map(r => ({
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
            const report = {
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
        }
        catch (e) {
            if (e instanceof BillingGateway_1.BillingError) {
                const status = e.code === "INSUFFICIENT_CREDITS" ? 402 : 403;
                return res.status(status).json({
                    success: false,
                    message: e.message,
                    code: e.code,
                    ...e.data,
                });
            }
            throw e;
        }
    }
    catch (error) {
        logger_1.default.error("Error in forensic audit", {
            error: error.message,
            stack: error.stack,
        });
        return res.status(500).json({
            success: false,
            error: error.message || "Forensic audit failed",
        });
    }
});
exports.default = router;
