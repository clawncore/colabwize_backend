import express from "express";
import { CitationIntentService } from "../../services/citationIntentService";
import { authenticateExpressRequest as authenticate } from "../../middleware/auth";
import logger from "../../monitoring/logger";

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
