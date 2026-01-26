import express from "express";
import logger from "../../monitoring/logger";
import { initializePrisma } from "../../lib/prisma-async";

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

export default router;
