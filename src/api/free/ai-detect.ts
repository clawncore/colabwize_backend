/**
 * Free AI Detection endpoint — GPTZero-powered AI content scanner.
 *
 * Public (no auth required) but rate-limited to prevent abuse.
 * Returns AI probability scores per sentence + overall classification.
 *
 * Usage: 3 scans per hour per IP (QuillBot-style abuse prevention).
 */

import express, { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import logger from "../../monitoring/logger";
import { AIDetectionService, type AIDetectionResult } from "../../services/aiDetectionService";

const router = express.Router();

const MAX_INPUT_CHARS = 25000; // ~2,000 words
const MIN_INPUT_CHARS = 10;
const MAX_FREE_SCANS = 3;
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

// 3 requests/hour anonymous — GPTZero API costs ~$0.001/scan
const aiDetectLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: MAX_FREE_SCANS,
  message: {
    success: false,
    message: "Free scan limit reached (3 per hour). Sign up for unlimited scans.",
    code: "RATE_LIMITED",
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Track remaining scans in response headers
  handler: (req, res) => {
    const resetTime = new Date(Date.now() + WINDOW_MS).toISOString();
    return res.status(429).json({
      success: false,
      message: `You've used all ${MAX_FREE_SCANS} free scans. Try again in 1 hour or sign up for unlimited scans.`,
      code: "RATE_LIMITED",
      resetsAt: resetTime,
    });
  },
});

router.post(
  "/ai-detect",
  aiDetectLimiter,
  async (req: Request, res: Response) => {
    const startTime = Date.now();

    try {
      const body = (req.body || {}) as Record<string, unknown>;

      // ── Input validation ──────────────────────────────────────────────
      if (typeof body.text !== "string" || body.text.trim().length < MIN_INPUT_CHARS) {
        return res.status(400).json({
          success: false,
          message: `text is required and must be at least ${MIN_INPUT_CHARS} characters`,
        });
      }

      if (body.text.length > MAX_INPUT_CHARS) {
        return res.status(400).json({
          success: false,
          message: `Text exceeds the ${MAX_INPUT_CHARS}-character limit for the free tool.`,
        });
      }

      // ── Run AI detection ─────────────────────────────────────────────
      const result: AIDetectionResult = await AIDetectionService.detectAI(body.text);

      // ── Calculate remaining scans ────────────────────────────────────
      // We can't directly read the rate limit counter, so we approximate:
      // The rate limiter tracks per-IP, so on success we know at least 1 scan used.
      // We use a conservative estimate.
      const remainingScans = Math.max(0, MAX_FREE_SCANS - 1);
      const resetsAt = new Date(Date.now() + WINDOW_MS).toISOString();

      const elapsed = Date.now() - startTime;
      logger.info("Free AI detection scan completed", {
        overallScore: result.overallScore,
        classification: result.classification,
        sentenceCount: result.sentences.length,
        elapsed,
      });

      return res.json({
        success: true,
        data: {
          overallScore: Math.round(result.overallScore * 10) / 10,
          classification: result.classification,
          sentences: result.sentences,
          scannedAt: result.scannedAt,
          remainingScans,
          resetsAt,
          scanDuration: elapsed,
        },
      });
    } catch (error: any) {
      logger.error("Free AI detection failed", { error: error.message });

      return res.status(500).json({
        success: false,
        message: error.message || "AI detection failed. Please try again.",
      });
    }
  },
);

export default router;
