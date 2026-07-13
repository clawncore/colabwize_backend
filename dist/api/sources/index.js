"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const sourceIntegrationService_1 = require("../../services/sourceIntegrationService");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const router = (0, express_1.Router)();
/**
 * @route POST /api/sources/integration-track
 * @desc Track a source interaction (reading time, open count)
 */
router.post("/integration-track", async (req, res) => {
    try {
        const userId = req.user.id;
        const { sourceId, projectId, sourceTitle, timeSpentReading, citationAddedTime } = req.body;
        if (!sourceId || !projectId) {
            return res.status(400).json({
                success: false,
                message: "sourceId and projectId are required",
            });
        }
        await sourceIntegrationService_1.SourceIntegrationService.trackSourceInteraction({
            sourceId,
            projectId,
            userId,
            sourceTitle,
            timeSpentReading: timeSpentReading || 0,
            citationAddedTime,
        });
        res.json({ success: true, message: "Source interaction tracked" });
    }
    catch (error) {
        logger_1.default.error("Error in integration-track endpoint", { error: error.message });
        res.status(500).json({ success: false, message: error.message });
    }
});
/**
 * @route POST /api/sources/mark-citation
 * @desc Mark that a citation was added for a source
 */
router.post("/mark-citation", async (req, res) => {
    try {
        const userId = req.user.id;
        const { sourceId, projectId } = req.body;
        if (!sourceId || !projectId) {
            return res.status(400).json({
                success: false,
                message: "sourceId and projectId are required",
            });
        }
        await sourceIntegrationService_1.SourceIntegrationService.markCitationAdded(projectId, userId, sourceId);
        res.json({ success: true, message: "Citation marked" });
    }
    catch (error) {
        logger_1.default.error("Error in mark-citation endpoint", { error: error.message });
        res.status(500).json({ success: false, message: error.message });
    }
});
/**
 * @route GET /api/sources/integration-verification/:projectId
 * @desc Get source integration verification report for a project
 */
router.get("/integration-verification/:projectId", async (req, res) => {
    try {
        const userId = req.user.id;
        const projectId = req.params.projectId;
        if (!projectId) {
            return res.status(400).json({
                success: false,
                message: "projectId is required",
            });
        }
        const report = await sourceIntegrationService_1.SourceIntegrationService.verifySourceIntegration(projectId, userId);
        res.json({ success: true, data: report });
    }
    catch (error) {
        logger_1.default.error("Error in integration-verification endpoint", { error: error.message });
        res.status(500).json({ success: false, message: error.message });
    }
});
/**
 * @route GET /api/sources/analytics/:projectId
 * @desc Get source analytics for a project
 */
router.get("/analytics/:projectId", async (req, res) => {
    try {
        const userId = req.user.id;
        const projectId = req.params.projectId;
        if (!projectId) {
            return res.status(400).json({
                success: false,
                message: "projectId is required",
            });
        }
        const analytics = await sourceIntegrationService_1.SourceIntegrationService.getSourceAnalytics(projectId, userId);
        res.json({ success: true, data: analytics });
    }
    catch (error) {
        logger_1.default.error("Error in analytics endpoint", { error: error.message });
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.default = router;
