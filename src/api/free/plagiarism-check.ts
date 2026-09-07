/**
 * Free plagiarism check endpoint — uses CopyscapeService.scanText().
 *
 * Public (no auth required), rate-limited. Powers the SEO
 * PlagiarismChecker landing page. Wraps the existing Copyscape
 * service and maps the response to the format the frontend expects.
 */
import express, { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import logger from "../../monitoring/logger";
import { CopyscapeService } from "../../services/copyscapeService";

const router = express.Router();

const MAX_WORDS = 5000;

const plagiarismLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,                   // 20 free checks per hour
  message: {
    success: false,
    message: "Free plagiarism check limit reached. Try again in an hour.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post(
  "/plagiarism-check",
  plagiarismLimiter,
  async (req: Request, res: Response) => {
    try {
      const { content } = req.body;

      if (!content || typeof content !== "string" || content.trim().length === 0) {
        return res.status(400).json({
          success: false,
          message: "Content is required and must be a non-empty string.",
        });
      }

      const words = content.split(/\s+/);
      const wordCount = words.length;

      if (wordCount > MAX_WORDS) {
        return res.status(400).json({
          success: false,
          message: `Content exceeds ${MAX_WORDS} word limit for the free tool.`,
        });
      }

      const { matches, summary } = await CopyscapeService.scanText(content);

      // Map to the format the frontend PlagiarismChecker expects
      const similarityScore = summary.allPercentMatched || 0;
      const originalityScore = Math.max(0, 100 - similarityScore);

      return res.json({
        success: true,
        data: {
          originalityScore,
          similarityScore,
          totalWords: wordCount,
          matches,
        },
      });
    } catch (error: any) {
      logger.error("Free plagiarism check failed", { error: error.message });
      return res.status(500).json({
        success: false,
        message: error.message || "Plagiarism check failed. Please try again.",
      });
    }
  }
);

export default router;
