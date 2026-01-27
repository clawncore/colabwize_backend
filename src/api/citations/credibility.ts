import express from "express";
import { CredibilityScoreService } from "../../services/credibilityScoreService";
import { authenticateExpressRequest as authenticate } from "../../middleware/auth";
import logger from "../../monitoring/logger";

const router = express.Router();

/**
 * POST /api/citations/credibility-score
 * Calculate credibility score for a single paper
 */
router.post("/credibility-score", authenticate, async (req, res) => {
    try {
        const paper = req.body;

        if (!paper || !paper.title) {
            return res.status(400).json({
                success: false,
                error: "Paper title is required"
            });
        }

        const score = CredibilityScoreService.calculateCredibility(paper);

        res.json({
            success: true,
            credibility: score
        });

    } catch (error: any) {
        logger.error("Failed to calculate credibility score", {
            error: error.message
        });
        res.status(500).json({
            success: false,
            error: "Failed to calculate credibility score"
        });
    }
});

/**
 * POST /api/citations/batch-credibility
 * Calculate credibility scores for multiple papers
 */
router.post("/batch-credibility", authenticate, async (req, res) => {
    try {
        const { papers } = req.body;

        if (!Array.isArray(papers)) {
            return res.status(400).json({
                success: false,
                error: "Papers array is required"
            });
        }

        const results = CredibilityScoreService.batchCalculateCredibility(papers);

        // Convert Map to object for JSON response
        const resultsObj: Record<string, any> = {};
        results.forEach((value, key) => {
            resultsObj[key] = value;
        });

        // Calculate statistics
        const scores = Array.from(results.values());
        const stats = {
            total: scores.length,
            highCredibility: scores.filter(s => s.level === "high").length,
            mediumCredibility: scores.filter(s => s.level === "medium").length,
            lowCredibility: scores.filter(s => s.level === "low").length,
            averageScore: scores.reduce((sum, s) => sum + s.score, 0) / scores.length
        };

        res.json({
            success: true,
            credibilityScores: resultsObj,
            statistics: stats
        });

    } catch (error: any) {
        logger.error("Failed to batch calculate credibility", {
            error: error.message
        });
        res.status(500).json({
            success: false,
            error: "Failed to calculate credibility scores"
        });
    }
});

export default router;
