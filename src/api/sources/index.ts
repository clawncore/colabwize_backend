import { Router, Request, Response } from "express";
import { SourceIntegrationService } from "../../services/sourceIntegrationService";
import logger from "../../monitoring/logger";

const router = Router();

interface AuthenticatedRequest extends Request {
    user?: {
        id: string;
        email: string;
    };
}

/**
 * @route POST /api/sources/integration-track
 * @desc Track a source interaction (reading time, open count)
 */
router.post("/integration-track", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const { sourceId, projectId, sourceTitle, timeSpentReading, citationAddedTime } = req.body;

        if (!sourceId || !projectId) {
            return res.status(400).json({
                success: false,
                message: "sourceId and projectId are required",
            });
        }

        await SourceIntegrationService.trackSourceInteraction({
            sourceId,
            projectId,
            userId,
            sourceTitle,
            timeSpentReading: timeSpentReading || 0,
            citationAddedTime,
        });

        res.json({ success: true, message: "Source interaction tracked" });
    } catch (error: any) {
        logger.error("Error in integration-track endpoint", { error: error.message });
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * @route POST /api/sources/mark-citation
 * @desc Mark that a citation was added for a source
 */
router.post("/mark-citation", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const { sourceId, projectId } = req.body;

        if (!sourceId || !projectId) {
            return res.status(400).json({
                success: false,
                message: "sourceId and projectId are required",
            });
        }

        await SourceIntegrationService.markCitationAdded(projectId, userId, sourceId);

        res.json({ success: true, message: "Citation marked" });
    } catch (error: any) {
        logger.error("Error in mark-citation endpoint", { error: error.message });
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * @route GET /api/sources/integration-verification/:projectId
 * @desc Get source integration verification report for a project
 */
router.get("/integration-verification/:projectId", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const projectId = req.params.projectId as string;

        if (!projectId) {
            return res.status(400).json({
                success: false,
                message: "projectId is required",
            });
        }

        const report = await SourceIntegrationService.verifySourceIntegration(projectId, userId);

        res.json({ success: true, data: report });
    } catch (error: any) {
        logger.error("Error in integration-verification endpoint", { error: error.message });
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * @route GET /api/sources/analytics/:projectId
 * @desc Get source analytics for a project
 */
router.get("/analytics/:projectId", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const projectId = req.params.projectId as string;

        if (!projectId) {
            return res.status(400).json({
                success: false,
                message: "projectId is required",
            });
        }

        const analytics = await SourceIntegrationService.getSourceAnalytics(projectId, userId);

        res.json({ success: true, data: analytics });
    } catch (error: any) {
        logger.error("Error in analytics endpoint", { error: error.message });
        res.status(500).json({ success: false, message: error.message });
    }
});

export default router;
