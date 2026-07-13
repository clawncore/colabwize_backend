"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const citationConfidenceService_1 = require("../../services/citationConfidenceService");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const requestHelpers_1 = require("../../utils/requestHelpers");
const auth_helpers_1 = require("../../lib/auth-helpers");
const BillingGateway_1 = require("../../billing/BillingGateway");
const router = express_1.default.Router();
/**
 * GET /api/citations/confidence/:projectId
 * Get citation confidence analysis for a project
 */
router.get("/confidence/:projectId", async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: "Authentication required",
            });
        }
        const { projectId } = req.params;
        const { field } = req.query; // Optional field parameter
        if (!projectId) {
            return res.status(400).json({
                success: false,
                error: "Project ID is required",
            });
        }
        const hasAccess = await (0, auth_helpers_1.checkProjectAccess)(projectId, userId);
        if (!hasAccess) {
            return res.status(403).json({
                success: false,
                error: "Access denied or project not found",
            });
        }
        // Run through the single billing pipeline (hold → execute →
        // confirm/release). Removes the old checkUsageLimit + incrementFeatureUsage
        // double-consume.
        const analysis = await BillingGateway_1.BillingGateway.withFeature(userId, "citation_audit", undefined, () => citationConfidenceService_1.CitationConfidenceService.analyzeProjectCitations(projectId, userId, (0, requestHelpers_1.getSafeString)(field) || "default"));
        logger_1.default.info("Citation confidence analysis retrieved", {
            userId,
            projectId,
            totalCitations: analysis.totalCitations,
            overallScore: analysis.overallConfidence.overall,
        });
        return res.status(200).json({ success: true, data: analysis });
    }
    catch (e) {
        if (e instanceof BillingGateway_1.BillingError) {
            const status = e.code === "INSUFFICIENT_CREDITS" ? 402 : 403;
            return res.status(status).json({
                success: false,
                message: e.message || "Plan limit reached",
                code: e.code,
                ...e.data,
            });
        }
        logger_1.default.error("Error getting citation confidence", {
            error: e.message,
            stack: e.stack,
        });
        return res.status(500).json({
            success: false,
            error: e.message || "Failed to analyze citation confidence",
        });
    }
});
/**
 * GET /api/citations/recency/:projectId
 * Get recency breakdown for project citations
 */
router.get("/recency/:projectId", async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: "Authentication required",
            });
        }
        const { projectId } = req.params;
        const { field } = req.query;
        if (!projectId) {
            return res.status(400).json({
                success: false,
                error: "Project ID is required",
            });
        }
        const hasAccess = await (0, auth_helpers_1.checkProjectAccess)(projectId, userId);
        if (!hasAccess) {
            return res.status(403).json({
                success: false,
                error: "Access denied",
            });
        }
        // Run through the single billing pipeline (hold → execute →
        // confirm/release).
        const analysis = await BillingGateway_1.BillingGateway.withFeature(userId, "citation_audit", undefined, () => citationConfidenceService_1.CitationConfidenceService.analyzeProjectCitations(projectId, userId, (0, requestHelpers_1.getSafeString)(field) || "default"));
        return res.status(200).json({
            success: true,
            data: {
                breakdown: analysis.citationBreakdown,
                totalCitations: analysis.totalCitations,
                hasRecentCitations: analysis.citationBreakdown.recent > 0,
                warning: analysis.citationBreakdown.recent === 0
                    ? "No citations from the last 3 years"
                    : null,
            },
        });
    }
    catch (e) {
        if (e instanceof BillingGateway_1.BillingError) {
            const status = e.code === "INSUFFICIENT_CREDITS" ? 402 : 403;
            return res.status(status).json({
                success: false,
                message: e.message || "Plan limit reached",
                code: e.code,
                ...e.data,
            });
        }
        logger_1.default.error("Error getting citation recency", {
            error: e.message,
            stack: e.stack,
        });
        return res.status(500).json({
            success: false,
            error: e.message || "Failed to analyze citation recency",
        });
    }
});
/**
 * POST /api/citations/verify-single
 * Real-time verification of a single citation
 */
router.post("/verify-single", 
// Rate limit? Maybe lighter limit
async (req, res) => {
    try {
        const { title, doi } = req.body;
        if (!title) {
            return res
                .status(400)
                .json({ success: false, error: "Title is required" });
        }
        const result = await citationConfidenceService_1.CitationConfidenceService.verifySingleCitation({
            title,
            doi,
        });
        return res.status(200).json({ success: true, data: result });
    }
    catch (error) {
        logger_1.default.error("Error confirming citation", { error: error.message });
        return res
            .status(500)
            .json({ success: false, error: "Verification failed" });
    }
});
/**
 * POST /api/citations/auto-fix
 * Find correct metadata for fuzzy citation
 */
router.post("/auto-fix", async (req, res) => {
    try {
        const { query } = req.body;
        if (!query)
            return res
                .status(400)
                .json({ success: false, error: "Query is required" });
        const result = await citationConfidenceService_1.CitationConfidenceService.findCitationMetadata(query);
        return res.status(200).json({ success: true, data: result });
    }
    catch (error) {
        return res.status(500).json({ success: false, error: "Auto-fix failed" });
    }
});
exports.default = router;
