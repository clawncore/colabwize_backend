"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const surveyService_1 = require("../../services/surveyService");
const hybridAuthMiddleware_1 = require("../../middleware/hybridAuthMiddleware");
const router = express_1.default.Router();
/**
 * POST /api/survey/submit
 * Submit survey responses (requires authentication)
 */
router.post("/submit", hybridAuthMiddleware_1.authenticateHybridRequest, async (req, res) => {
    try {
        const user = req.user;
        const { role, institution, fieldOfStudy, primaryUseCase, heardAboutPlatform, userGoal, mainJob } = req.body;
        if (!user) {
            return res.status(401).json({
                success: false,
                message: "Not authenticated",
            });
        }
        if (!role) {
            return res.status(400).json({
                success: false,
                message: "Role is required",
            });
        }
        const result = await surveyService_1.SurveyService.submitSurvey(user.id, {
            role,
            institution,
            fieldOfStudy,
            primaryUseCase,
            heardAboutPlatform,
            userGoal,
            mainJob,
        });
        if (result.success) {
            return res.status(200).json(result);
        }
        else {
            return res.status(400).json(result);
        }
    }
    catch (error) {
        console.error("Submit survey error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to submit survey. Please try again.",
        });
    }
});
/**
 * GET /api/survey/status
 * Get survey status (requires authentication)
 */
router.get("/status", hybridAuthMiddleware_1.authenticateHybridRequest, async (req, res) => {
    try {
        const user = req.user;
        if (!user) {
            return res.status(401).json({
                success: false,
                message: "Not authenticated",
            });
        }
        const status = await surveyService_1.SurveyService.getSurveyStatus(user.id);
        return res.status(200).json({
            success: true,
            ...status,
        });
    }
    catch (error) {
        console.error("Get survey status error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to get survey status.",
        });
    }
});
exports.default = router;
