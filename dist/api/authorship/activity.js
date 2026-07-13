"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const activityTrackingService_1 = require("../../services/activityTrackingService");
const auth_1 = require("../../middleware/auth");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const requestHelpers_1 = require("../../utils/requestHelpers");
const router = express_1.default.Router();
/**
 * POST /api/authorship/record-activity
 * Record authorship activity (time spent, edits, keystrokes)
 */
router.post("/record-activity", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: "Authentication required",
            });
        }
        const { projectId, timeSpent, editCount, keystrokes, wordCount, manualEdits, aiAssistedEdits, } = req.body;
        if (!projectId || timeSpent === undefined || editCount === undefined) {
            return res.status(400).json({
                success: false,
                error: "projectId, timeSpent, and editCount are required",
            });
        }
        await activityTrackingService_1.ActivityTrackingService.recordActivity({
            projectId,
            userId,
            timeSpent,
            editCount,
            keystrokes,
            wordCount,
            manualEdits: manualEdits ?? editCount, // Default to editCount if manualEdits missing (assume manual)
            aiAssistedEdits: aiAssistedEdits ?? 0,
            sessionStart: new Date(Date.now() - timeSpent * 1000),
            sessionEnd: new Date(),
        });
        logger_1.default.info("Activity recorded successfully", {
            userId,
            projectId,
            timeSpent,
            editCount,
        });
        return res.status(200).json({
            success: true,
            message: "Activity recorded successfully",
        });
    }
    catch (error) {
        logger_1.default.error("Error recording activity", {
            error: error.message,
            stack: error.stack,
        });
        return res.status(500).json({
            success: false,
            error: error.message || "Failed to record activity",
        });
    }
});
/**
 * GET /api/authorship/stats/:projectId
 * Get authorship statistics for a project
 */
router.get("/stats/:projectId", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: "Authentication required",
            });
        }
        const { projectId } = req.params;
        if (!projectId) {
            return res.status(400).json({
                success: false,
                error: "Project ID is required",
            });
        }
        const stats = await activityTrackingService_1.ActivityTrackingService.getActivityStats(projectId, userId);
        return res.status(200).json({
            success: true,
            data: stats,
        });
    }
    catch (error) {
        logger_1.default.error("Error getting authorship stats", {
            error: error.message,
            stack: error.stack,
        });
        return res.status(500).json({
            success: false,
            error: error.message || "Failed to get authorship statistics",
        });
    }
});
/**
 * GET /api/authorship/quick-stats/:projectId
 * Get quick authorship stats for dashboard display
 */
router.get("/quick-stats/:projectId", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: "Authentication required",
            });
        }
        const { projectId } = req.params;
        if (!projectId) {
            return res.status(400).json({
                success: false,
                error: "Project ID is required",
            });
        }
        const summary = await activityTrackingService_1.ActivityTrackingService.getActivitySummary(projectId, userId);
        // Extract quick stats
        const quickStats = {
            totalTimeSpent: activityTrackingService_1.ActivityTrackingService.formatTimeForCertificate(summary.totalTimeSpent),
            totalEdits: summary.totalEdits,
            totalSessions: summary.totalSessions,
            lastActivity: summary.lastActivity,
        };
        return res.status(200).json({
            success: true,
            data: quickStats,
        });
    }
    catch (error) {
        logger_1.default.error("Error getting quick stats", {
            error: error.message,
            stack: error.stack,
        });
        return res.status(500).json({
            success: false,
            error: error.message || "Failed to get quick statistics",
        });
    }
});
/**
 * POST /api/authorship/generate-certificate
 * Generate authorship certificate for a project
 */
router.post("/generate-certificate", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: "Authentication required",
            });
        }
        const { projectId } = req.body;
        if (!projectId) {
            return res.status(400).json({
                success: false,
                error: "Project ID is required",
            });
        }
        const certificateStats = await activityTrackingService_1.ActivityTrackingService.getCertificateStats(projectId, userId);
        logger_1.default.info("Certificate generated", {
            userId,
            projectId,
        });
        return res.status(200).json({
            success: true,
            data: certificateStats,
        });
    }
    catch (error) {
        logger_1.default.error("Error generating certificate", {
            error: error.message,
            stack: error.stack,
        });
        return res.status(500).json({
            success: false,
            error: error.message || "Failed to generate certificate",
        });
    }
});
/**
 * GET /api/authorship/detailed-tracking/:projectId
 * Get detailed granular activity tracking for a project
 */
router.get("/detailed-tracking/:projectId", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: "Authentication required",
            });
        }
        const { projectId } = req.params;
        if (!projectId) {
            return res.status(400).json({
                success: false,
                error: "Project ID is required",
            });
        }
        const { timeFrameDays = "30" } = req.query;
        const days = parseInt((0, requestHelpers_1.getSafeString)(timeFrameDays) || "30") || 30;
        const detailedTracking = await activityTrackingService_1.ActivityTrackingService.getDetailedActivityTracking(projectId, userId, days);
        return res.status(200).json({
            success: true,
            data: detailedTracking,
        });
    }
    catch (error) {
        logger_1.default.error("Error getting detailed activity tracking", {
            error: error.message,
            stack: error.stack,
        });
        return res.status(500).json({
            success: false,
            error: error.message || "Failed to get detailed activity tracking",
        });
    }
});
exports.default = router;
