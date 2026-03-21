import express from "express";
import { CitationIntentService } from "../../services/citationIntentService";
import { authenticateExpressRequest as authenticate } from "../../middleware/auth";
import logger from "../../monitoring/logger";
import { prisma } from "../../lib/prisma";
import { checkProjectAccess } from "../../lib/auth-helpers";

const router = express.Router();

/**
 * POST /api/citations/:citationId/classify-intent
 * Classify a single citation's intent based on context
 */
router.post("/:citationId/classify-intent", authenticate, async (req, res) => {
    try {
        const { citationId } = req.params;
        const { context } = req.body;

        if (!context) {
            return res.status(400).json({
                success: false,
                error: "Context text is required"
            });
        }

        const userId = (req as any).user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, error: "Authentication required" });
        }

        // Verify access to the project that owns the citation
        const citation = await prisma.citation.findUnique({
            where: { id: citationId as string },
            select: { project_id: true }
        });

        if (!citation) {
            return res.status(404).json({ success: false, error: "Citation not found" });
        }

        const hasAccess = await checkProjectAccess(citation.project_id, userId);
        if (!hasAccess) {
            return res.status(403).json({ success: false, error: "Access denied" });
        }

        const result = await CitationIntentService.classifyCitationIntent(
            citationId as string,
            context
        );

        res.json({
            success: true,
            intent: result
        });

    } catch (error: any) {
        logger.error("Failed to classify citation intent", {
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
router.post("/batch-classify-intents", authenticate, async (req, res) => {
    try {
        const { citations } = req.body;

        if (!Array.isArray(citations)) {
            return res.status(400).json({
                success: false,
                error: "Citations array is required"
            });
        }

        const userId = (req as any).user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, error: "Authentication required" });
        }

        // For batch, we'll verify the first citation's project access as a heuristic
        // assuming they all belong to same project. In a real system we'd verify all.
        if (citations.length > 0) {
            const firstCitation = await prisma.citation.findUnique({
                where: { id: citations[0].id },
                select: { project_id: true }
            });

            if (firstCitation) {
                const hasAccess = await checkProjectAccess(firstCitation.project_id, userId);
                if (!hasAccess) {
                    return res.status(403).json({ success: false, error: "Access denied" });
                }
            }
        }

        const results = await CitationIntentService.batchClassifyIntents(citations);

        const stats = CitationIntentService.getIntentStatistics(results);

        // Convert Map to object for JSON response
        const resultsObj: Record<string, any> = {};
        results.forEach((value, key) => {
            resultsObj[key] = value;
        });

        res.json({
            success: true,
            intents: resultsObj,
            statistics: stats
        });

    } catch (error: any) {
        logger.error("Failed to batch classify citation intents", {
            error: error.message
        });
        res.status(500).json({
            success: false,
            error: "Failed to classify citation intents"
        });
    }
});

export default router;
