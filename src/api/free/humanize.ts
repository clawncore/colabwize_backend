/**
 * Free-tool humanize endpoint — Writing Transformation Pipeline.
 *
 * Public (no auth), rate-limited. Powers the SEO Humanizer landing page.
 * Streams SSE events for progressive frontend rendering.
 *
 * Pipeline: Text Analysis → Rewrite Engine → Quality Scoring
 * Uses gpt-4o-mini for both stages. Falls back to local heuristic if LLM unavailable.
 */

import express, { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import logger from "../../monitoring/logger";
import { runHumanizationPipeline } from "../../services/humanizer/pipeline";
import type { HumanizeRequest, HumanizeMode, WritingStyle, SEOOptimizationLevel } from "../../services/humanizer/types";

const router = express.Router();

const MAX_INPUT_CHARS = 7000; // ~1,000 words
const MIN_INPUT_CHARS = 10;

// 20 requests/hour anonymous — each costs ~$0.002 in LLM tokens
const humanizeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: {
    success: false,
    message: "Free humanizer limit reached (20 per hour). Try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Valid enums
const VALID_MODES: HumanizeMode[] = ["humanize", "humanize_seo", "seo_optimize", "improve_writing"];
const VALID_STYLES: WritingStyle[] = ["natural", "professional", "academic", "conversational", "technical", "simple"];
const VALID_SEO: SEOOptimizationLevel[] = ["off", "balanced", "strong"];

router.post(
  "/humanize",
  humanizeLimiter,
  async (req: Request, res: Response) => {
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

      // Parse and validate options
      const mode: HumanizeMode = VALID_MODES.includes(body.mode as HumanizeMode)
        ? (body.mode as HumanizeMode)
        : "humanize";

      const style: WritingStyle = VALID_STYLES.includes(body.style as WritingStyle)
        ? (body.style as WritingStyle)
        : "natural";

      const seoOptimize: SEOOptimizationLevel = VALID_SEO.includes(body.seoOptimize as SEOOptimizationLevel)
        ? (body.seoOptimize as SEOOptimizationLevel)
        : "off";

      const preserveStructure = body.preserveStructure !== false;
      const preserveKeywords = body.preserveKeywords !== false;
      const preserveTerminology = body.preserveTerminology !== false;

      const request: HumanizeRequest = {
        text: body.text,
        mode,
        style,
        seoOptimize,
        preserveStructure,
        preserveKeywords,
        preserveTerminology,
      };

      // ── Set up SSE response ──────────────────────────────────────────
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      // Run the pipeline
      const pipelineStream = runHumanizationPipeline(body.text, request);

      // Pipe pipeline events to SSE response
      const reader = pipelineStream.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        res.write(chunk);
      }

      res.end();
    } catch (error: any) {
      logger.error("Free humanize failed", { error: error.message });

      // If headers already sent (SSE in progress), send error event
      if (res.headersSent) {
        res.write(`event: error\ndata: ${JSON.stringify({ message: "Humanization failed. Please try again." })}\n\n`);
        res.end();
      } else {
        return res.status(500).json({
          success: false,
          message: "Humanization failed. Please try again.",
        });
      }
    }
  },
);

export default router;
