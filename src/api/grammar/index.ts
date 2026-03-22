import express from "express";
import { GrammarService } from "../../services/GrammarService";
import logger from "../../monitoring/logger";

const router = express.Router();

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

        const errors = await GrammarService.checkGrammar(text);

        return res.status(200).json({
            success: true,
            errors,
        });
    } catch (error: any) {
        logger.error("Grammar check API error", { error: error.message });
        return res.status(500).json({
            success: false,
            message: "Failed to check grammar",
            error: error.message,
        });
    }
});

export default router;
