import express from "express";
import { ResearchGapService } from "../../services/researchGapService";
import { authenticateExpressRequest as authenticate } from "../../middleware/auth";
import logger from "../../monitoring/logger";
import { checkProjectAccess } from "../../lib/auth-helpers";

const router = express.Router();

/**
 * GET /api/citations/:projectId/gaps
 * Returns research gap analysis for a project's citations
 */
router.get("/:projectId/gaps", authenticate, async (req, res) => {
    try {
        const { projectId } = req.params;
        const userId = (req as any).user?.id;

        if (!userId) {
            return res.status(401).json({ success: false, error: "Authentication required" });
        }

        const hasAccess = await checkProjectAccess(projectId as string, userId);
        if (!hasAccess) {
            return res.status(403).json({ success: false, error: "Access denied" });
        }

        // Analyze research gaps
        const gaps = await ResearchGapService.analyzeGaps(projectId as string);

        res.json({
            success: true,
            gaps,
            count: gaps.length
        });

    } catch (error: any) {
        logger.error("Failed to analyze research gaps", {
            projectId: req.params.projectId,
            error: error.message
        });
        res.status(500).json({
            success: false,
            error: "Failed to analyze research gaps"
        });
    }
});

export default router;
