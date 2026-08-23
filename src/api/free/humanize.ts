/**
 * Free-tool humanize endpoint.
 *
 * Public (no auth), rate-limited. Powers the SEO Humanizer landing page.
 * Uses the same HumanizerService as the in-app tool (OpenAI first, local
 * heuristic fallback) but without billing — the free ceiling is the
 * rate limit itself.
 */

import express, { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import logger from "../../monitoring/logger";
import { HumanizerService } from "../../services/humanizerService";

const router = express.Router();

const MAX_INPUT_CHARS = 5000;

// 10 requests/hour anonymous — the service makes one paid LLM call each.
const humanizeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: {
    success: false,
    message: "Free humanizer limit reached (10 per hour). Try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post(
  "/humanize",
  humanizeLimiter,
  async (req: Request, res: Response) => {
    try {
      const { text } = (req.body || {}) as { text?: unknown };

      if (typeof text !== "string" || text.trim().length < 10) {
        return res.status(400).json({
          success: false,
          message: "text is required and must be at least 10 characters",
        });
      }

      if (text.length > MAX_INPUT_CHARS) {
        return res.status(400).json({
          success: false,
          message: `Text exceeds the ${MAX_INPUT_CHARS}-character limit for the free tool.`,
        });
      }

      const result = await HumanizerService.humanizeText(text);

      return res.json({
        success: true,
        data: {
          original: text,
          variations: result.variations,
          provider: result.provider,
        },
      });
    } catch (error: any) {
      logger.error("Free humanize failed", { error: error.message });
      return res.status(500).json({
        success: false,
        message: "Humanization failed. Please try again.",
      });
    }
  },
);

export default router;
