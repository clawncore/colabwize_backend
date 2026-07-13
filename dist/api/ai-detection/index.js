"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const aiDetectionService_1 = require("../../services/aiDetectionService");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const router = (0, express_1.Router)();
/**
 * @route POST /api/ai-detection/scan
 * @desc Scan text for AI-generated content
 * @access Private
 */
router.post("/scan", async (req, res) => {
    try {
        const { content } = req.body;
        if (!content || typeof content !== "string") {
            return res.status(400).json({
                success: false,
                message: "Content is required and must be a string",
            });
        }
        const results = await aiDetectionService_1.AIDetectionService.detectAI(content);
        res.json({
            success: true,
            data: results,
        });
    }
    catch (error) {
        logger_1.default.error("AI Detection API Error", { error: error.message });
        res.status(500).json({
            success: false,
            message: error.message || "Failed to scan for AI content",
        });
    }
});
exports.default = router;
