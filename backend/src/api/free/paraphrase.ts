import { Router, Request, Response } from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";
import logger from "../../monitoring/logger";

const router = Router();

// Mode-specific prompts for paraphrasing
const MODE_PROMPTS: Record<string, string> = {
  standard:
    "Rewrite the following text to improve clarity and flow while preserving meaning. Keep the same tone and level of formality.",
  fluency:
    "Rewrite the following text to improve readability and natural flow. Make it smooth and easy to read while keeping the original meaning.",
  formal:
    "Rewrite the following text in a more formal, professional tone suitable for academic or business writing.",
  academic:
    "Rewrite the following text in scholarly academic register. Use precise terminology and formal sentence structures appropriate for a research paper.",
  creative:
    "Rewrite the following text with richer vocabulary and more varied sentence structures while preserving the core meaning.",
  shorten:
    "Condense the following text to about 80% of its original length. Remove redundancy while preserving all key points.",
  expand:
    "Expand the following text with more detail and elaboration. Add relevant context and explanation while maintaining the original tone.",
};

// Simple rate limiting (in-memory)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 30; // requests per hour
const RATE_WINDOW = 60 * 60 * 1000; // 1 hour

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_WINDOW });
    return true;
  }

  if (record.count >= RATE_LIMIT) {
    return false;
  }

  record.count++;
  return true;
}

// Initialize Gemini client lazily
let genAI: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI {
  if (!genAI) {
    const apiKey = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("AI API key not configured");
    }
    genAI = new GoogleGenerativeAI(apiKey);
  }
  return genAI;
}

router.post("/paraphrase", async (req: Request, res: Response) => {
  try {
    const { text, mode = "standard", language, freezeWords = [] } = req.body;

    if (!text || typeof text !== "string") {
      res.status(400).json({
        success: false,
        message: "Text is required",
      });
      return;
    }

    if (text.length > 8000) {
      res.status(400).json({
        success: false,
        message: "Text exceeds maximum length of 8,000 characters",
      });
      return;
    }

    // Rate limit check
    const clientIp = req.ip || req.socket.remoteAddress || "unknown";
    if (!checkRateLimit(clientIp)) {
      res.status(429).json({
        success: false,
        message: "Rate limit exceeded. Please try again later.",
      });
      return;
    }

    const prompt = MODE_PROMPTS[mode] || MODE_PROMPTS.standard;

    // Build the full prompt with freeze words instruction
    let systemPrompt = prompt;
    if (freezeWords && freezeWords.length > 0) {
      systemPrompt += `\n\nIMPORTANT: Do NOT change or rewrite these words/phrases (keep them exactly as-is): ${freezeWords.join(", ")}`;
    }
    if (language && language !== "en") {
      systemPrompt += `\n\nThe output language should be: ${language}`;
    }

    const client = getGenAI();
    const model = client.getGenerativeModel({ model: "gemini-2.0-flash" });

    const result = await model.generateContent([
      systemPrompt,
      text,
    ]);

    const rewritten = result.response?.text() || "";

    if (!rewritten) {
      res.status(500).json({
        success: false,
        message: "Failed to generate paraphrased text",
      });
      return;
    }

    res.json({
      success: true,
      data: {
        rewritten,
        mode,
      },
    });
  } catch (error: any) {
    logger.error("Paraphrase error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Paraphrase service unavailable",
    });
  }
});

export default router;
