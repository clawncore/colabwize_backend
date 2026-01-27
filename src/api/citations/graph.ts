import express from "express";
import { AnalysisGraphService } from "../../services/analysisGraphService";
import { authenticateExpressRequest as authenticate } from "../../middleware/auth";
import logger from "../../monitoring/logger";

const router = express.Router();

/**
 * GET /api/citations/:projectId/graph
 * Returns graph data (nodes/links) for the visual insight map
 */
router.get("/:projectId/graph", authenticate, async (req, res) => {
    try {
        const { projectId } = req.params;

        // In production, verify user owns projectProject

        const graphData = await AnalysisGraphService.getProjectGraph(projectId as string);

        res.json(graphData);
    } catch (error: any) {
        logger.error("Failed to generate graph data", { projectId: req.params.projectId, error: error.message });
        res.status(500).json({ error: "Failed to generate graph data" });
    }
});

export default router;
