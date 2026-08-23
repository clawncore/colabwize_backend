/**
 * Free-tool paraphrase endpoint.
 *
 * Public (no auth required) but rate-limited. Powers the SEO
 * ParaphrasingAssistant landing page so the public marketing tool actually
 * hits the LLM instead of running local regex.
 */

import express, { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import logger from "../../monitoring/logger";
import { chatComplete } from "../../services/llm/llmClient";

const router = express.Router();

const MAX_INPUT_CHARS = 8000;          // 1500 words ceiling for free tool
const MAX_OUTPUT_VARIANTS = 3;

const paraphraseLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,            // 1 hour
  max: 30,                            // anonymous ceiling
  message: {
    success: false,
    message: "Daily free paraphrase limit reached. Try again in an hour.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

interface ParaphraseRequestBody {
  text: string;
  mode?: "standard" | "fluency" | "formal" | "academic" | "creative" | "shorten" | "expand";
  language?: string;
}

// Languages exposed on the landing page — must stay in sync with
// ParaphrasingAssistant.tsx. Unknown values are rejected, not defaulted,
// so the UI can't silently drift from what the model actually does.
const LANGUAGE_INSTRUCTIONS: Record<string, string> = {
  "English (US)": "Write the rewritten passage in American English.",
  "English (UK)": "Write the rewritten passage in British English.",
  French: "Écris le texte réécrit en français. Preserve quoted titles, proper nouns and citations exactly as written.",
  Spanish: "Escribe el texto reescrito en español. Preserve quoted titles, proper nouns and citations exactly as written.",
  German: "Schreibe den umgeschriebenen Text auf Deutsch. Preserve quoted titles, proper nouns and citations exactly as written.",
};

const MODE_PROMPTS: Record<NonNullable<ParaphraseRequestBody["mode"]>, string> = {
  standard: "Preserve the author's tone. Vary sentence structure and replace a few common words with natural synonyms. Do not over-edit.",
  fluency: "Smooth the flow. Fix awkward phrasing and improve readability without changing the register.",
  formal: "Elevate casual phrasing into formal academic prose. Expand contractions, remove colloquialisms.",
  academic: "Adopt a precise academic register. Tighten prose, remove filler (\"very\", \"really\"), prefer concise verbs.",
  creative: "Introduce varied sentence openings and richer vocabulary while preserving meaning. Avoid purple prose.",
  shorten: "Condense to roughly 80% of the original length. Remove filler, keep every citation and number.",
  expand: "Elaborate with connective tissue while keeping all citations, numbers, and claims intact.",
};

router.post(
  "/paraphrase",
  paraphraseLimiter,
  async (req: Request, res: Response) => {
    try {
      const { text, mode = "standard", language = "English (US)" } =
        (req.body || {}) as ParaphraseRequestBody;

      if (typeof text !== "string" || text.trim().length === 0) {
        return res.status(400).json({
          success: false,
          message: "text is required and must be a non-empty string",
        });
      }

      if (text.length > MAX_INPUT_CHARS) {
        return res.status(400).json({
          success: false,
          message: `Text exceeds ${MAX_INPUT_CHARS} character limit for the free tool.`,
        });
      }

      const languageInstruction = LANGUAGE_INSTRUCTIONS[language];
      if (!languageInstruction) {
        return res.status(400).json({
          success: false,
          message: `Unsupported language "${language}". Supported: ${Object.keys(LANGUAGE_INSTRUCTIONS).join(", ")}`,
        });
      }

      const systemPrompt = `You are an expert academic paraphraser. Rewrite the user's passage using the "${mode}" mode.

Mode guidance: ${MODE_PROMPTS[mode]}
Language: ${languageInstruction}

Hard rules — never violate:
1. Preserve every citation, reference, author, year, DOI, and URL exactly as written.
2. Preserve every numerical value, percentage, unit, and symbol.
3. Do not invent facts or references.
4. Preserve technical terminology.
5. No unicode homoglyphs, invisible characters, or fake sophistication.

Output: Return ONLY the rewritten passage. No preamble, no explanation, no numbering.`;

      const rewritten = await chatComplete(systemPrompt, text, {
        temperature: mode === "creative" ? 0.6 : 0.4,
        maxTokens: 2000,
      });

      if (!rewritten) {
        return res.status(503).json({
          success: false,
          message:
            "AI paraphraser is temporarily unavailable. Please try again in a few minutes.",
        });
      }

      return res.json({
        success: true,
        data: {
          original: text,
          rewritten,
          mode,
        },
      });
    } catch (error: any) {
      logger.error("Free paraphrase failed", { error: error.message });
      return res.status(500).json({
        success: false,
        message: error.message || "Paraphrase failed",
      });
    }
  },
);

export default router;
