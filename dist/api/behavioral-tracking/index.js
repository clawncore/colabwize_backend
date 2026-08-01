"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const logger_1 = __importDefault(require("../../monitoring/logger"));
const prisma_async_1 = require("../../lib/prisma-async");
const realTimeAuthorshipTrackingService_1 = require("../../services/realTimeAuthorshipTrackingService");
const BillingGateway_1 = require("../../billing/BillingGateway");
const router = express_1.default.Router();
// Rate limit the ingest endpoint to prevent abuse — the client sends periodic
// summaries every few seconds, so 60/min per user is generous.
const trackingLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    max: 60,
    keyGenerator: (req) => req.user?.id ?? req.ip,
    message: { success: false, message: "Too many tracking requests. Please slow down." },
});
router.post("/", trackingLimiter, async (req, res) => {
    try {
        const trackingData = req.body;
        // Fallback to userId from body if not found in auth token (e.g. for robust tracking)
        const userId = req.user?.id || trackingData.userId;
        if (!userId) {
            // Ideally we should require auth, but if we want to track anonymous usage we'd need a guest user strategy
            // For now, if no user is logged in, we can't satisfy the foreign key constraint on AnalyticsEvent
            return res.status(401).json({ success: false, message: "Unauthorized: User ID required for tracking" });
        }
        const prisma = await (0, prisma_async_1.initializePrisma)();
        // Check format: Is it aggregated summary (typingSpeedVariations) or raw events?
        const isAggregatedData = Array.isArray(trackingData.typingSpeedVariations);
        if (isAggregatedData) {
            if (!trackingData.projectId) {
                return res.status(400).json({ success: false, message: "Invalid payload: projectId required" });
            }
            // Store summary
            await prisma.analyticsEvent.create({
                data: {
                    user_id: userId,
                    project_id: trackingData.projectId,
                    event_type: "writing_pattern_update",
                    event_name: "periodic_scan",
                    event_data: trackingData,
                    timestamp: new Date(),
                    session_id: trackingData.sessionId || null
                }
            });
            logger_1.default.info("Saved behavioral pattern summary", { userId, projectId: trackingData.projectId });
        }
        else if (trackingData.events && Array.isArray(trackingData.events)) {
            // Raw events logic
            if (!trackingData.projectId) {
                return res.status(400).json({ success: false, message: "Invalid payload: projectId required" });
            }
            const analyticsEvents = trackingData.events.map((event) => ({
                user_id: userId,
                project_id: trackingData.projectId,
                event_type: "behavioral",
                event_name: event.type,
                event_data: event.data || {},
                timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),
                session_id: trackingData.sessionId || null
            }));
            if (analyticsEvents.length > 0) {
                await prisma.analyticsEvent.createMany({
                    data: analyticsEvents,
                    skipDuplicates: true
                });
            }
            logger_1.default.info("Saved behavioral tracking data", { userId, count: analyticsEvents.length });
        }
        else {
            return res.status(400).json({ success: false, message: "Invalid payload format" });
        }
        res.status(200).json({ success: true, message: "Tracking data saved successfully" });
    }
    catch (error) {
        logger_1.default.error("Error saving behavioral tracking data", { error: error.message });
        res.status(500).json({ success: false, message: "Internal server error" });
    }
});
// Analyze patterns to generate "Writing DNA" report
router.post("/analyze/:projectId", async (req, res) => {
    try {
        const { projectId } = req.params;
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        // Run through the single billing pipeline (hold → execute →
        // confirm/release), consuming one unit of 'certificate' quota.
        let responseData;
        try {
            const report = await BillingGateway_1.BillingGateway.withFeature(userId, "certificate", undefined, () => realTimeAuthorshipTrackingService_1.RealTimeAuthorshipTrackingService.generateAuthenticityReport(projectId, userId));
            // Map to Frontend Expected Format (WritingDNAReport)
            responseData = {
                humanAuthenticityScore: report.authenticityScore,
                averageTypingSpeed: report.detailedMetrics.typingPatterns.typingSpeed,
                thinkPauseRatio: 0, // Placeholder as backend calc might differ
                errorCorrectionFrequency: report.detailedMetrics.typingPatterns.backspaceRate, // Proxy
                revisionPatternComplexity: report.detailedMetrics.typingPatterns.editingDepth, // Proxy
                writingRhythmScore: report.writingPatternConsistency,
                isConsistentWithHumanWriting: report.authenticityScore > 50
            };
        }
        catch (billingError) {
            if (billingError instanceof BillingGateway_1.BillingError) {
                const status = billingError.code === "INSUFFICIENT_CREDITS" ? 402 : 403;
                return res.status(status).json({
                    success: false,
                    message: billingError.message,
                    code: billingError.code,
                    ...billingError.data,
                });
            }
            throw billingError;
        }
        res.json(responseData);
    }
    catch (error) {
        logger_1.default.error("Error analyzing patterns", { error: error.message, stack: error.stack });
        res.status(500).json({ success: false, message: "Internal server error" });
    }
});
// Get raw patterns (for debug or detailed view)
router.get("/patterns/:projectId", async (req, res) => {
    try {
        const { projectId } = req.params;
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        // No entitlement consumption for viewing *existing* patterns? 
        // Or maybe this is the detail view. 
        // For now, let's allow it without consumption if it's just data retrieval.
        const patterns = await realTimeAuthorshipTrackingService_1.RealTimeAuthorshipTrackingService.calculateWritingPatterns(projectId, userId);
        // Map to expected format if needed, or return as is.
        // Frontend expects: typingSpeedVariations (array), etc.
        // Backend returns: typingSpeed (number), etc.
        // We'll return what we have, frontend might need adjustment if it strictly requires arrays.
        // But the main 404 block is likely the POST /analyze.
        res.json(patterns);
    }
    catch (error) {
        logger_1.default.error("Error getting patterns", { error: error.message });
        res.status(500).json({ success: false, message: "Internal server error" });
    }
});
exports.default = router;
