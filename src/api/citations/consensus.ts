import express from "express";
import { ConsensusAnalysisService } from "../../services/consensusAnalysisService";
import { authenticateExpressRequest as authenticate } from "../../middleware/auth";
import logger from "../../monitoring/logger";
import { initializePrisma } from "../../lib/prisma-async";

const router = express.Router();

/**
 * POST /api/citations/:projectId/consensus
 * Analyze consensus on a specific claim across project citations
 */
router.post("/:projectId/consensus", authenticate, async (req, res) => {
    try {
        const { projectId } = req.params;
        const { claim, citationIds } = req.body;

        if (!claim) {
            return res.status(400).json({
                success: false,
                error: "Claim is required"
            });
        }

        const prisma = await initializePrisma();

        // Get citations to analyze
        // Get all citations for the project with abstracts
        const whereClause: any = { project_id: projectId };
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

        const consensus = await ConsensusAnalysisService.analyzeConsensus(
            claim,
            citationsWithAbstracts
        );

        res.json({
            success: true,
            consensus
        });

    } catch (error: any) {
        logger.error("Failed to analyze consensus", {
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
router.get("/:projectId/consensus-topics", authenticate, async (req, res) => {
    try {
        const { projectId } = req.params;

        const topics = await ConsensusAnalysisService.extractConsensusTopics(projectId as string);

        res.json({
            success: true,
            topics
        });

    } catch (error: any) {
        logger.error("Failed to get consensus topics", {
            error: error.message
        });
        res.status(500).json({
            success: false,
            error: "Failed to retrieve consensus topics"
        });
    }
});

export default router;
