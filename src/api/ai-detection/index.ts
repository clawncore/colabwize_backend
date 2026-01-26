import { Router, Request, Response } from "express";
import { AIDetectionService } from "../../services/aiDetectionService";
import logger from "../../monitoring/logger";

const router = Router();

/**
 * @route POST /api/ai-detection/scan
 * @desc Scan text for AI-generated content
 * @access Private
 */
router.post("/scan", async (req: Request, res: Response) => {
    try {
        const { content } = req.body;

        if (!content || typeof content !== "string") {
            return res.status(400).json({
                success: false,
                message: "Content is required and must be a string",
            });
        }

        const results = await AIDetectionService.detectAI(content);

        res.json({
            success: true,
            data: results,
        });
    } catch (error: any) {
        logger.error("AI Detection API Error", { error: error.message });
        res.status(500).json({
            success: false,
            message: error.message || "Failed to scan for AI content",
        });
    }
});

export default router;
