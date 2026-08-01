"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const consensusAnalysisService_1 = require("../../services/consensusAnalysisService");
const auth_1 = require("../../middleware/auth");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const prisma_async_1 = require("../../lib/prisma-async");
const auth_helpers_1 = require("../../lib/auth-helpers");
const router = express_1.default.Router();
/**
 * POST /api/citations/:projectId/consensus
 * Analyze consensus on a specific claim across project citations
 */
router.post("/:projectId/consensus", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const { projectId } = req.params;
        const { claim, citationIds } = req.body;
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, error: "Authentication required" });
        }
        const hasAccess = await (0, auth_helpers_1.checkProjectAccess)(projectId, userId);
        if (!hasAccess) {
            return res.status(403).json({ success: false, error: "Access denied" });
        }
        if (!claim) {
            return res.status(400).json({
                success: false,
                error: "Claim is required"
            });
        }
        const prisma = await (0, prisma_async_1.initializePrisma)();
        // Get citations to analyze
        // Get all citations for the project with abstracts
        const whereClause = { project_id: projectId };
        if (citationIds && citationIds.length > 0) {
            whereClause.id = { in: citationIds };
        }
        const citations = await prisma.citation.findMany({
            where: whereClause,
            select: {
                id: true,
                title: true,
                abstract: true
            }
        });
        if (citations.length === 0) {
            return res.status(404).json({
                success: false,
                error: "No citations found"
            });
        }
        // Extract abstracts from metadata
        const citationsWithAbstracts = citations.map(c => ({
            id: c.id,
            title: c.title,
            abstract: c.abstract || c.title
        }));
        const consensus = await consensusAnalysisService_1.ConsensusAnalysisService.analyzeConsensus(claim, citationsWithAbstracts);
        res.json({
            success: true,
            consensus
        });
    }
    catch (error) {
        logger_1.default.error("Failed to analyze consensus", {
            error: error.message
        });
        res.status(500).json({
            success: false,
            error: "Failed to analyze consensus"
        });
    }
});
/**
 * GET /api/citations/:projectId/consensus-topics
 * Get all consensus topics for a project
 */
router.get("/:projectId/consensus-topics", auth_1.authenticateExpressRequest, async (req, res) => {
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
        const topics = await consensusAnalysisService_1.ConsensusAnalysisService.extractConsensusTopics(projectId);
        res.json({
            success: true,
            topics
        });
    }
    catch (error) {
        logger_1.default.error("Failed to get consensus topics", {
            error: error.message
        });
        res.status(500).json({
            success: false,
            error: "Failed to retrieve consensus topics"
        });
    }
});
exports.default = router;
