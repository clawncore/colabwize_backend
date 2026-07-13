"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const GrammarService_1 = require("../../services/GrammarService");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const router = express_1.default.Router();
/**
 * @route POST /api/grammar/check
 * @desc Check text for grammar, spelling, and style errors
 * @access Private
 */
router.post("/check", async (req, res) => {
    try {
        const { text } = req.body;
        if (!text) {
            return res.status(400).json({
                success: false,
                message: "Text is required",
            });
        }
        if (text.length > 5000) {
            return res.status(400).json({
                success: false,
                message: "Text is too long. Please check smaller chunks (max 5000 chars).",
            });
        }
        const errors = await GrammarService_1.GrammarService.checkGrammar(text);
        return res.status(200).json({
            success: true,
            errors,
        });
    }
    catch (error) {
        logger_1.default.error("Grammar check API error", { error: error.message });
        return res.status(500).json({
            success: false,
            message: "Failed to check grammar",
            error: error.message,
        });
    }
});
exports.default = router;
