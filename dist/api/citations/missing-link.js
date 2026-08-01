"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const missingLinkService_1 = require("../../services/missingLinkService");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const prisma_1 = require("../../lib/prisma");
const api_response_1 = require("../../lib/api-response");
const auth_helpers_1 = require("../../lib/auth-helpers");
const router = express_1.default.Router();
// Rate limiter
const missingLinkLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000, // 1 minute
    max: 20, // 20 requests per minute
    message: "Too many requests, please try again later",
    standardHeaders: true,
    legacyHeaders: false,
});
/**
 * POST /api/citations/find-missing-link
 * Suggest relevant academic papers
 */
router.post("/find-missing-link", missingLinkLimiter, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return (0, api_response_1.sendErrorResponse)(res, 401, "Authentication required");
        }
        const { projectId, keywords, field, citationStyle } = req.body;
        // Validation
        if (!projectId) {
            return (0, api_response_1.sendErrorResponse)(res, 400, "projectId is required");
        }
        const hasAccess = await (0, auth_helpers_1.checkProjectAccess)(projectId, userId);
        if (!hasAccess) {
            return (0, api_response_1.sendErrorResponse)(res, 403, "Access denied");
        }
        if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
            return (0, api_response_1.sendErrorResponse)(res, 400, "keywords must be a non-empty array");
        }
        logger_1.default.info("Finding missing link suggestions", {
            userId,
            projectId,
            keywords,
            field,
        });
        // Get suggestions
        const suggestions = await missingLinkService_1.MissingLinkService.suggestPapers(keywords, field || "default", 3);
        return (0, api_response_1.sendJsonResponse)(res, 200, {
            suggestions,
            cached: false, // Caching not required for real-time paper searches
        });
    }
    catch (error) {
        logger_1.default.error("Error finding missing link", { error: error.message });
        return (0, api_response_1.sendErrorResponse)(res, 500, error.message || "Failed to find missing link suggestions");
    }
});
/**
 * GET /api/citations/summary
 * Get citation summary data for analytics
 */
router.get("/summary", async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return (0, api_response_1.sendErrorResponse)(res, 401, "Authentication required");
        }
        // Get citation statistics for the user
        const fixedCitations = await prisma_1.prisma.citation.count({
            where: {
                user_id: userId,
                is_reliable: true,
            },
        });
        const totalCitations = await prisma_1.prisma.citation.count({
            where: {
                user_id: userId,
            },
        });
        // Get previous fix rate for comparison (from last week)
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
        const previousFixedCitations = await prisma_1.prisma.citation.count({
            where: {
                user_id: userId,
                is_reliable: true,
                created_at: {
                    gte: oneWeekAgo,
                },
            },
        });
        const previousTotalCitations = await prisma_1.prisma.citation.count({
            where: {
                user_id: userId,
                created_at: {
                    gte: oneWeekAgo,
                },
            },
        });
        const fixRate = totalCitations > 0
            ? Math.round((fixedCitations / totalCitations) * 100)
            : 0;
        const previousFixRate = previousTotalCitations > 0
            ? Math.round((previousFixedCitations / previousTotalCitations) * 100)
            : 0;
        return (0, api_response_1.sendJsonResponse)(res, 200, {
            fixed_citations_count: fixedCitations,
            total_citations_count: totalCitations,
            fix_rate: fixRate,
            previous_fix_rate: previousFixRate,
        });
    }
    catch (error) {
        logger_1.default.error("Error getting citation summary", { error: error.message });
        return (0, api_response_1.sendErrorResponse)(res, 500, error.message || "Failed to get citation summary");
    }
});
exports.default = router;
