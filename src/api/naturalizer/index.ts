/**
 * Academic Writing Naturalizer — API routes.
 *
 * POST /api/naturalizer/naturalize  run the adversarial rewrite pipeline
 * POST /api/naturalizer/analyze    cheap structural stats (no LLM call)
 * POST /api/naturalizer/validate   integrity-check a user-pasted rewrite
 *
 * Public (no auth) but rate-limited hard — the naturalize route makes up to
 * MAX_ITERATIONS paid LLM calls per request, so the anonymous ceiling is
 * deliberately much lower than the free paraphrase tool's.
 */

import express, { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import logger from "../../monitoring/logger";
import {
  MAX_INPUT_CHARS,
  MAX_ITERATIONS,
  analyzeText,
  naturalize,
} from "../../services/naturalizer/rewriteEngine";
import { preprocess } from "../../services/naturalizer/protectedEntities";
import { validate } from "../../services/naturalizer/validators";

const router = express.Router();

// 5 requests/hour anonymous — each request can trigger 3 LLM calls.
const naturalizeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: {
    success: false,
    message: "Free naturalization limit reached (5 per hour). Try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Cheap endpoints get a normal ceiling.
const analysisLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 120,
  message: { success: false, message: "Too many analysis requests." },
  standardHeaders: true,
  legacyHeaders: false,
});

interface NaturalizeBody {
  text: string;
  mode?: "light" | "moderate" | "strong";
  discipline?:
    | "general"
    | "stem"
    | "medicine"
    | "law"
    | "humanities"
    | "socialscience";
}

router.post(
  "/naturalize",
  naturalizeLimiter,
  async (req: Request, res: Response) => {
    try {
      const { text, mode = "moderate", discipline = "general" } =
        (req.body || {}) as NaturalizeBody;

      if (typeof text !== "string" || text.trim().length === 0) {
        return res.status(400).json({
          success: false,
          message: "text is required and must be a non-empty string",
        });
      }
      if (text.length > MAX_INPUT_CHARS) {
        return res.status(400).json({
          success: false,
          message: `Text exceeds the ${MAX_INPUT_CHARS}-character limit.`,
        });
      }

      const result = await naturalize({ text, mode, discipline });
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error("Naturalize endpoint failed", { error: error.message });
      return res.status(500).json({
        success: false,
        message: error.message || "Naturalization failed",
      });
    }
  },
);

router.post(
  "/analyze",
  analysisLimiter,
  async (req: Request, res: Response) => {
    try {
      const { text } = (req.body || {}) as { text?: unknown };
      if (typeof text !== "string" || text.trim().length === 0) {
        return res
          .status(400)
          .json({ success: false, message: "text is required" });
      }
      const stats = analyzeText(text);
      return res.json({ success: true, data: { stats, maxIterations: MAX_ITERATIONS } });
    } catch (error: any) {
      logger.error("Analyze endpoint failed", { error: error.message });
      return res.status(500).json({ success: false, message: error.message });
    }
  },
);

router.post(
  "/validate",
  analysisLimiter,
  async (req: Request, res: Response) => {
    try {
      const { original, rewritten } = (req.body || {}) as {
        original?: unknown;
        rewritten?: unknown;
      };
      if (
        typeof original !== "string" ||
        typeof rewritten !== "string" ||
        !original.trim() ||
        !rewritten.trim()
      ) {
        return res.status(400).json({
          success: false,
          message: "original and rewritten are both required",
        });
      }

      // Run validators against the raw pair; entity masking isn't needed here
      // because we compare the two texts directly.
      const report = validate(original, rewritten, []);
      return res.json({ success: true, data: report });
    } catch (error: any) {
      logger.error("Validate endpoint failed", { error: error.message });
      return res.status(500).json({ success: false, message: error.message });
    }
  },
);

export default router;
