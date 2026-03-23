import express from "express";
import { AnalysisGraphService } from "../../services/analysisGraphService";
import { authenticateExpressRequest as authenticate } from "../../middleware/auth";
import logger from "../../monitoring/logger";
import { checkProjectAccess } from "../../lib/auth-helpers";

const router = express.Router();

/**
 * GET /api/citations/:projectId/graph
 * Returns graph data (nodes/links) for the visual insight map
 */
router.get("/:projectId/graph", authenticate, async (req, res) => {
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

        const graphData = await AnalysisGraphService.getProjectGraph(projectId as string);

        res.json(graphData);
    } catch (error: any) {
        logger.error("Failed to generate graph data", { projectId: req.params.projectId, error: error.message });
        res.status(500).json({ error: "Failed to generate graph data" });
    }
});

export default router;
