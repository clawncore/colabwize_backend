import express from "express";
import logger from "../../monitoring/logger";
import { initializePrisma } from "../../lib/prisma-async";
import { RealTimeAuthorshipTrackingService } from "../../services/realTimeAuthorshipTrackingService";
import { EntitlementService } from "../../services/EntitlementService";

const router = express.Router();

router.post("/", async (req, res) => {
    try {
        const trackingData = req.body;
        // Fallback to userId from body if not found in auth token (e.g. for robust tracking)
        const userId = (req as any).user?.user_id || trackingData.userId;

        if (!userId) {
            // Ideally we should require auth, but if we want to track anonymous usage we'd need a guest user strategy
            // For now, if no user is logged in, we can't satisfy the foreign key constraint on AnalyticsEvent
            return res.status(401).json({ success: false, message: "Unauthorized: User ID required for tracking" });
        }

        const prisma = await initializePrisma();

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

            logger.info("Saved behavioral pattern summary", { userId, projectId: trackingData.projectId });

        } else if (trackingData.events && Array.isArray(trackingData.events)) {
            // Raw events logic
            if (!trackingData.projectId) {
                return res.status(400).json({ success: false, message: "Invalid payload: projectId required" });
            }

            const analyticsEvents = trackingData.events.map((event: any) => ({
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
            logger.info("Saved behavioral tracking data", { userId, count: analyticsEvents.length });
        } else {
            return res.status(400).json({ success: false, message: "Invalid payload format" });
        }

        res.status(200).json({ success: true, message: "Tracking data saved successfully" });
    } catch (error: any) {
        logger.error("Error saving behavioral tracking data", { error: error.message });
        res.status(500).json({ success: false, message: "Internal server error" });
    }
});

// Analyze patterns to generate "Writing DNA" report
router.post("/analyze/:projectId", async (req, res) => {
    try {
        const { projectId } = req.params;
        const userId = (req as any).user?.user_id;

        if (!userId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        // 1. Check Entitlement (Limit Check)
        // Consumes 1 unit of 'certificate' entitlement
        // If failed, throws error which we catch below
        await EntitlementService.assertCanUse(userId, "certificate", { projectId });

        // 2. Generate Report
        const report = await RealTimeAuthorshipTrackingService.generateAuthenticityReport(projectId, userId);

        // 3. Map to Frontend Expected Format (WritingDNAReport)
        const responseData = {
            humanAuthenticityScore: report.authenticityScore,
            averageTypingSpeed: report.detailedMetrics.typingPatterns.typingSpeed,
            thinkPauseRatio: 0, // Placeholder as backend calc might differ
            errorCorrectionFrequency: report.detailedMetrics.typingPatterns.backspaceRate, // Proxy
            revisionPatternComplexity: report.detailedMetrics.typingPatterns.editingDepth, // Proxy
            writingRhythmScore: report.writingPatternConsistency,
            isConsistentWithHumanWriting: report.authenticityScore > 50
        };

        res.json(responseData);

    } catch (error: any) {
        logger.error("Error analyzing patterns", { error: error.message, stack: error.stack });

        // Handle Plan Limits specifically
        if (error.message.includes("limit reached") || error.code === "INSUFFICIENT_CREDITS" || error.message.includes("not available")) {
            return res.status(403).json({
                success: false,
                message: error.message,
                code: error.code || "PLAN_LIMIT_REACHED"
            });
        }

        res.status(500).json({ success: false, message: "Internal server error" });
    }
});

// Get raw patterns (for debug or detailed view)
router.get("/patterns/:projectId", async (req, res) => {
    try {
        const { projectId } = req.params;
        const userId = (req as any).user?.user_id;

        if (!userId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        // No entitlement consumption for viewing *existing* patterns? 
        // Or maybe this is the detail view. 
        // For now, let's allow it without consumption if it's just data retrieval.

        const patterns = await RealTimeAuthorshipTrackingService.calculateWritingPatterns(projectId, userId);

        // Map to expected format if needed, or return as is.
        // Frontend expects: typingSpeedVariations (array), etc.
        // Backend returns: typingSpeed (number), etc.
        // We'll return what we have, frontend might need adjustment if it strictly requires arrays.
        // But the main 404 block is likely the POST /analyze.

        res.json(patterns);

    } catch (error: any) {
        logger.error("Error getting patterns", { error: error.message });
        res.status(500).json({ success: false, message: "Internal server error" });
    }
});

export default router;
