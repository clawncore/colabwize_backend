"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const researchGapService_1 = require("../../services/researchGapService");
const auth_1 = require("../../middleware/auth");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const auth_helpers_1 = require("../../lib/auth-helpers");
const router = express_1.default.Router();
/**
 * GET /api/citations/:projectId/gaps
 * Returns research gap analysis for a project's citations
 */
router.get("/:projectId/gaps", auth_1.authenticateExpressRequest, async (req, res) => {
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
        // Analyze research gaps
        const gaps = await researchGapService_1.ResearchGapService.analyzeGaps(projectId);
        res.json({
            success: true,
            gaps,
            count: gaps.length
        });
    }
    catch (error) {
        logger_1.default.error("Failed to analyze research gaps", {
            projectId: req.params.projectId,
            error: error.message
        });
        res.status(500).json({
            success: false,
            error: "Failed to analyze research gaps"
        });
    }
});
exports.default = router;
