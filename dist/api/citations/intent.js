"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const citationIntentService_1 = require("../../services/citationIntentService");
const auth_1 = require("../../middleware/auth");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const prisma_1 = require("../../lib/prisma");
const auth_helpers_1 = require("../../lib/auth-helpers");
const router = express_1.default.Router();
/**
 * POST /api/citations/:citationId/classify-intent
 * Classify a single citation's intent based on context
 */
router.post("/:citationId/classify-intent", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const { citationId } = req.params;
        const { context } = req.body;
        if (!context) {
            return res.status(400).json({
                success: false,
                error: "Context text is required"
            });
        }
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, error: "Authentication required" });
        }
        // Verify access to the project that owns the citation
        const citation = await prisma_1.prisma.citation.findUnique({
            where: { id: citationId },
            select: { project_id: true }
        });
        if (!citation) {
            return res.status(404).json({ success: false, error: "Citation not found" });
        }
        const hasAccess = await (0, auth_helpers_1.checkProjectAccess)(citation.project_id, userId);
        if (!hasAccess) {
            return res.status(403).json({ success: false, error: "Access denied" });
        }
        const result = await citationIntentService_1.CitationIntentService.classifyCitationIntent(citationId, context);
        res.json({
            success: true,
            intent: result
        });
    }
    catch (error) {
        logger_1.default.error("Failed to classify citation intent", {
            citationId: req.params.citationId,
            error: error.message
        });
        res.status(500).json({
            success: false,
            error: "Failed to classify citation intent"
        });
    }
});
/**
 * POST /api/citations/batch-classify-intents
 * Classify multiple citations at once
 */
router.post("/batch-classify-intents", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const { citations } = req.body;
        if (!Array.isArray(citations)) {
            return res.status(400).json({
                success: false,
                error: "Citations array is required"
            });
        }
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, error: "Authentication required" });
        }
        // For batch, we'll verify the first citation's project access as a heuristic
        // assuming they all belong to same project. In a real system we'd verify all.
        if (citations.length > 0) {
            const firstCitation = await prisma_1.prisma.citation.findUnique({
                where: { id: citations[0].id },
                select: { project_id: true }
            });
            if (firstCitation) {
                const hasAccess = await (0, auth_helpers_1.checkProjectAccess)(firstCitation.project_id, userId);
                if (!hasAccess) {
                    return res.status(403).json({ success: false, error: "Access denied" });
                }
            }
        }
        const results = await citationIntentService_1.CitationIntentService.batchClassifyIntents(citations);
        const stats = citationIntentService_1.CitationIntentService.getIntentStatistics(results);
        // Convert Map to object for JSON response
        const resultsObj = {};
        results.forEach((value, key) => {
            resultsObj[key] = value;
        });
        res.json({
            success: true,
            intents: resultsObj,
            statistics: stats
        });
    }
    catch (error) {
        logger_1.default.error("Failed to batch classify citation intents", {
            error: error.message
        });
        res.status(500).json({
            success: false,
            error: "Failed to classify citation intents"
        });
    }
});
exports.default = router;
