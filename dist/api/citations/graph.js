"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const analysisGraphService_1 = require("../../services/analysisGraphService");
const auth_1 = require("../../middleware/auth");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const auth_helpers_1 = require("../../lib/auth-helpers");
const router = express_1.default.Router();
/**
 * GET /api/citations/:projectId/graph
 * Returns graph data (nodes/links) for the visual insight map
 */
router.get("/:projectId/graph", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const { projectId } = req.params;
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, error: "Authentication required" });
        }
        const hasAccess = await (0, auth_helpers_1.checkProjectAccess)(projectId, userId);
        if (!hasAccess) {
            return res.status(403).json({ success: false, error: "Access denied" });
        }
        const graphData = await analysisGraphService_1.AnalysisGraphService.getProjectGraph(projectId);
        res.json(graphData);
    }
    catch (error) {
        logger_1.default.error("Failed to generate graph data", { projectId: req.params.projectId, error: error.message });
        res.status(500).json({ error: "Failed to generate graph data" });
    }
});
exports.default = router;
