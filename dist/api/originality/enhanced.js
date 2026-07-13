"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const enhancedOriginalityDetectionService_1 = require("../../services/enhancedOriginalityDetectionService");
const rephraseService_1 = require("../../services/rephraseService");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const subscriptionService_1 = require("../../services/subscriptionService");
const BillingGateway_1 = require("../../billing/BillingGateway");
const router = express_1.default.Router();
// Rate limiters
const scanLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000, // 1 minute
    max: 5, // 5 requests per minute (more restrictive for enhanced service)
    message: "Too many enhanced scan requests, please try again later",
    standardHeaders: true,
    legacyHeaders: false,
});
const rephraseLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 requests per minute
    message: "Too many rephrase requests, please try again later",
    standardHeaders: true,
    legacyHeaders: false,
});
/**
 * POST /api/originality/enhanced/scan
 * Enhanced scan document for originality with academic database integration
 */
router.post("/scan", scanLimiter, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Authentication required",
            });
        }
        const { projectId, content } = req.body;
        // Validation
        if (!projectId || !content) {
            return res.status(400).json({
                success: false,
                message: "projectId and content are required",
            });
        }
        if (typeof content !== "string" || content.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: "Content must be a non-empty string",
            });
        }
        // Get user's plan limits
        const planName = await subscriptionService_1.SubscriptionService.getActivePlan(userId);
        const limits = subscriptionService_1.SubscriptionService.getPlanLimits(planName);
        const characterLimit = limits.max_scan_characters || 20000; // Default safe fallback
        if (content.length > characterLimit) {
            return res.status(400).json({
                success: false,
                message: `Content too large for your plan. Limit: ${characterLimit.toLocaleString()} chars. Upgrade for more!`,
                limit: characterLimit
            });
        }
        logger_1.default.info("Starting enhanced originality scan", { userId, projectId });
        // Run the scan through the single billing pipeline (hold → execute →
        // confirm/release). Removes the old checkUsageLimit + incrementFeatureUsage
        // double-consume that the middleware comments themselves flagged.
        const wordCount = content.trim().split(/\s+/).length;
        // ── Originality billing disabled per request (code preserved) ──
        // const result = await BillingGateway.withFeature(
        //   userId,
        //   "originality_scan",
        //   { wordCount },
        //   async () => {
        //     const { OriginalityMapService } = await import("../../services/originalityMapService.js");
        //     return OriginalityMapService.startScan(projectId, userId, content);
        //   },
        // );
        const { OriginalityMapService } = await import("../../services/originalityMapService.js");
        const result = await OriginalityMapService.startScan(projectId, userId, content);
        return res.status(200).json({ success: true, data: result });
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
        logger_1.default.error("Error in enhanced scan endpoint", { error: e.message });
        return res.status(500).json({
            success: false,
            message: e.message || "Failed to scan document",
        });
    }
});
/**
 * GET /api/originality/enhanced/scan/:scanId
 * Get enhanced scan results by ID
 */
router.get("/scan/:scanId", async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Authentication required",
            });
        }
        const { scanId } = req.params;
        if (!scanId) {
            return res.status(400).json({
                success: false,
                message: "scanId is required",
            });
        }
        const result = await enhancedOriginalityDetectionService_1.EnhancedOriginalityDetectionService.getScanResults(scanId, userId);
        return res.status(200).json({
            success: true,
            data: result,
        });
    }
    catch (error) {
        logger_1.default.error("Error getting enhanced scan results", {
            error: error.message,
        });
        if (error.message.includes("not found") ||
            error.message.includes("access denied")) {
            return res.status(404).json({
                success: false,
                message: "Scan not found",
            });
        }
        return res.status(500).json({
            success: false,
            message: error.message || "Failed to get scan results",
        });
    }
});
/**
 * GET /api/originality/enhanced/project/:projectId
 * Get all enhanced scans for a project
 */
router.get("/project/:projectId", async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Authentication required",
            });
        }
        const { projectId } = req.params;
        if (!projectId) {
            return res.status(400).json({
                success: false,
                message: "projectId is required",
            });
        }
        const results = await enhancedOriginalityDetectionService_1.EnhancedOriginalityDetectionService.getProjectScans(projectId, userId);
        return res.status(200).json({
            success: true,
            data: results,
        });
    }
    catch (error) {
        logger_1.default.error("Error getting enhanced project scans", {
            error: error.message,
        });
        return res.status(500).json({
            success: false,
            message: error.message || "Failed to get project scans",
        });
    }
});
/**
 * POST /api/originality/enhanced/rephrase
 * Get rephrase suggestions for flagged text using enhanced analysis
 */
router.post("/rephrase", rephraseLimiter, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Authentication required",
            });
        }
        const { scanId, matchId, originalText } = req.body;
        // Validation
        if (!scanId || !matchId || !originalText) {
            return res.status(400).json({
                success: false,
                message: "scanId, matchId, and originalText are required",
            });
        }
        if (typeof originalText !== "string" ||
            originalText.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: "originalText must be a non-empty string",
            });
        }
        logger_1.default.info("Generating enhanced rephrase suggestions", {
            userId,
            scanId,
            matchId,
        });
        // Run through the single billing pipeline (hold → execute →
        // confirm/release).
        const wordCount = originalText.trim().split(/\s+/).length;
        const suggestions = await BillingGateway_1.BillingGateway.withFeature(userId, "rephrase", { inputWords: wordCount }, () => rephraseService_1.RephraseService.generateRephraseSuggestions(scanId, matchId, originalText, userId));
        return res.status(200).json({ success: true, data: suggestions });
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
        logger_1.default.error("Error generating enhanced rephrase suggestions", {
            error: e.message,
        });
        if (e.message.includes("not found") ||
            e.message.includes("access denied")) {
            return res.status(404).json({
                success: false,
                message: "Scan not found",
            });
        }
        return res.status(500).json({
            success: false,
            message: e.message || "Failed to generate rephrase suggestions",
        });
    }
});
exports.default = router;
