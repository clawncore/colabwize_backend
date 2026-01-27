import express from "express";
import { ResearchGapService } from "../../services/researchGapService";
import { authenticateExpressRequest as authenticate } from "../../middleware/auth";
import logger from "../../monitoring/logger";

const router = express.Router();

/**
 * GET /api/citations/:projectId/gaps
 * Returns research gap analysis for a project's citations
 */
router.get("/:projectId/gaps", authenticate, async (req, res) => {
    try {
        const { projectId } = req.params;

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
