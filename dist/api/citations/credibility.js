"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const credibilityScoreService_1 = require("../../services/credibilityScoreService");
const auth_1 = require("../../middleware/auth");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const api_response_1 = require("../../lib/api-response");
const router = express_1.default.Router();
/**
 * POST /api/citations/credibility-score
 * Calculate credibility score for a single paper
 */
router.post("/credibility-score", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const paper = req.body;
        if (!paper || !paper.title) {
            return res.status(400).json({
                success: false,
                error: "Paper title is required",
            });
        }
        const score = credibilityScoreService_1.CredibilityScoreService.calculateCredibility(paper);
        (0, api_response_1.sendJsonResponse)(res, 200, score);
    }
    catch (error) {
        logger_1.default.error("Failed to calculate credibility score", {
            error: error.message,
        });
        (0, api_response_1.sendErrorResponse)(res, 500, "Failed to calculate credibility score");
    }
});
/**
 * POST /api/citations/batch-credibility
 * Calculate credibility scores for multiple papers
 */
router.post("/batch-credibility", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const { papers } = req.body;
        if (!Array.isArray(papers)) {
            return (0, api_response_1.sendErrorResponse)(res, 400, "Papers array is required");
        }
        const results = credibilityScoreService_1.CredibilityScoreService.batchCalculateCredibility(papers);
        // Convert Map to object for JSON response
        const resultsObj = {};
        results.forEach((value, key) => {
            resultsObj[key] = value;
        });
        // Calculate statistics
        const scores = Array.from(results.values());
        const stats = {
            total: scores.length,
            highCredibility: scores.filter((s) => s.level === "high").length,
            mediumCredibility: scores.filter((s) => s.level === "medium").length,
            lowCredibility: scores.filter((s) => s.level === "low").length,
            averageScore: scores.reduce((sum, s) => sum + s.score, 0) / scores.length,
        };
        (0, api_response_1.sendJsonResponse)(res, 200, {
            credibilityScores: resultsObj,
            statistics: stats,
        });
    }
    catch (error) {
        logger_1.default.error("Failed to batch calculate credibility", {
            error: error.message,
        });
        (0, api_response_1.sendErrorResponse)(res, 500, "Failed to calculate credibility scores");
    }
});
exports.default = router;
