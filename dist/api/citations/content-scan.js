"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const citationConfidenceService_1 = require("../../services/citationConfidenceService");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const auth_helpers_1 = require("../../lib/auth-helpers");
const BillingGateway_1 = require("../../billing/BillingGateway");
const router = express_1.default.Router();
/**
 * POST /api/citations/content-scan
 * Scan text content for missing citations
 */
router.post("/content-scan", async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: "Authentication required",
            });
        }
        const { content, projectId } = req.body;
        if (!content && !projectId) {
            return res.status(400).json({
                success: false,
                error: "Content or Project ID is required",
            });
        }
        let textToScan = content;
        // If projectId is provided but no content, fetch from project
        if (!textToScan && projectId) {
            const hasAccess = await (0, auth_helpers_1.checkProjectAccess)(projectId, userId);
            if (!hasAccess) {
                return res.status(404).json({
                    success: false,
                    error: "Project not found or access denied",
                });
            }
            // Assuming content is stored in project.content (JSON) or we extract it
            // For now, let's assume we can't easily extract from JSON in this simple pass
            // unless we have a helper.
            // But wait, the user might be editing live.
            // It's safer if the Frontend sends the content.
            // If we strictly need to support projectId-only scan, we'd need a JSON->Text converter here.
            // For MVP, if content is missing, we'll error if we can't get it easily.
            // Let's assume the frontend sends the content for now.
            return res.status(400).json({
                success: false,
                error: "Please provide content to scan",
            });
        }
        // Run through the single billing pipeline (hold → execute →
        // confirm/release). Removes the old checkUsageLimit + incrementFeatureUsage
        // double-consume.
        const wordCount = typeof textToScan === "string" ? textToScan.trim().split(/\s+/).length : 0;
        const suggestions = await BillingGateway_1.BillingGateway.withFeature(userId, "citation_audit", { wordCount }, async () => citationConfidenceService_1.CitationConfidenceService.scanContentForCitations(textToScan));
        return res.status(200).json({
            success: true,
            data: {
                suggestions,
                matchCount: suggestions.length,
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
        logger_1.default.error("Error scanning content for citations", {
            error: e.message,
            stack: e.stack,
        });
        return res.status(500).json({
            success: false,
            error: e.message || "Failed to scan content",
        });
    }
});
exports.default = router;
