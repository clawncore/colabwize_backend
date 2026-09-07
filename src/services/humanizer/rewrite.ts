/**
 * Stage 2: Rewrite Engine
 *
 * Receives the original text + full analysis context from Stage 1,
 * then rewrites the text according to the user's chosen mode and style.
 *
 * Uses gpt-4o-mini for cost efficiency. Streams output tokens for
 * progressive frontend rendering.
 *
 * Returns: streaming response + completion metadata (scores, improvements).
 */

import { streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { SecretsService } from "../secrets-service";
import { buildRewriteSystemPrompt, buildRewriteUserPrompt } from "./prompts";
import { detectQualityIssues, semanticSimilarity } from "./heuristics";
import type { RewriteOptions, RewriteResult, QualityScores, SEOInsights, TextAnalysis } from "./types";
import logger from "../../monitoring/logger";

// ── Response parsing ────────────────────────────────────────────────────────

interface RewriteResponse {
  rewritten: string;
  scores: QualityScores;
  improvements: string[];
}

function parseRewriteResponse(raw: string): RewriteResponse | null {
  try {
    let cleaned = raw.trim();
    if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
    if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
    if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
    cleaned = cleaned.trim();

    // Remove trailing commas
    cleaned = cleaned.replace(/,\s*([\]}])/g, "$1");

    const parsed = JSON.parse(cleaned);

    if (!parsed.rewritten) return null;

    const scores: QualityScores = {
      semanticPreservation: clamp(parsed.scores?.semanticPreservation ?? 80),
      factualConsistency: clamp(parsed.scores?.factualConsistency ?? 90),
      readability: clamp(parsed.scores?.readability ?? 75),
      naturalness: clamp(parsed.scores?.naturalness ?? 75),
      structure: clamp(parsed.scores?.structure ?? 80),
      topicalCoverage: clamp(parsed.scores?.topicalCoverage ?? 70),
      overallQuality: 0,
    };

    // Calculate weighted overall quality
    scores.overallQuality = Math.round(
      0.25 * scores.semanticPreservation +
      0.20 * scores.factualConsistency +
      0.15 * scores.naturalness +
      0.15 * scores.topicalCoverage +
      0.10 * scores.readability +
      0.10 * scores.structure +
      0.05 * 80 // default for search intent alignment when not separately scored
    );

    return {
      rewritten: parsed.rewritten,
      scores,
      improvements: Array.isArray(parsed.improvements) ? parsed.improvements : [],
    };
  } catch (e) {
    logger.warn("[Humanizer] Failed to parse rewrite JSON", {
      error: (e as Error).message,
      rawPreview: raw.slice(0, 200),
    });
    return null;
  }
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

// ── Post-processing: heuristic quality scoring ──────────────────────────────

function computeHeuristicScores(
  original: string,
  rewritten: string,
): Partial<QualityScores> {
  const similarity = semanticSimilarity(original, rewritten);
  const issues = detectQualityIssues(rewritten);
  const highIssues = issues.filter((i) => i.severity === "high").length;
  const medIssues = issues.filter((i) => i.severity === "medium").length;

  const naturalnessPenalty = highIssues * 8 + medIssues * 3;
  const naturalness = Math.max(0, 85 - naturalnessPenalty);

  return {
    semanticPreservation: similarity,
    naturalness,
  };
}

// ── SEO insights ────────────────────────────────────────────────────────────

function buildSEOInsights(
  analysis: TextAnalysis,
  rewritten: string,
): SEOInsights {
  const primaryKeyword = analysis.seo.primaryTopic || analysis.keywords[0]?.term || "";
  const keywordCount = primaryKeyword
    ? (rewritten.toLowerCase().match(new RegExp(primaryKeyword.toLowerCase(), "g")) || []).length
    : 0;
  const wordCount = rewritten.split(/\s+/).length;
  const density = wordCount > 0 ? (keywordCount * primaryKeyword.split(/\s+/).length) / wordCount : 0;

  return {
    primaryKeyword,
    keywordPlacement: keywordCount === 0 ? "absent" : density > 0.04 ? "forced" : "natural",
    topicCoverage: analysis.seo.entityCoverage,
    intentAlignment: analysis.seo.searchIntent,
    improvements: [
      ...(analysis.seo.topicGaps.length > 0
        ? [`Addressed topic gaps: ${analysis.seo.topicGaps.slice(0, 2).join(", ")}`]
        : []),
      ...(primaryKeyword ? [`Primary keyword "${primaryKeyword}" used ${keywordCount}x`] : []),
    ],
  };
}

// ── Main export: non-streaming (for backward compat) ────────────────────────

/**
 * Rewrite text without streaming. Returns the full result at once.
 * Used by the authenticated /api/originality/humanize endpoint
 * and as fallback when streaming isn't needed.
 */
export async function rewriteTextSync(
  originalText: string,
  analysis: TextAnalysis,
  analysisJson: string,
  options: RewriteOptions,
): Promise<RewriteResult> {
  const startTime = Date.now();

  try {
    const apiKey = await SecretsService.getOpenAiApiKey();
    const model = process.env.REWRITER_MODEL || "gpt-4o-mini";

    const systemPrompt = buildRewriteSystemPrompt(options);
    const userPrompt = buildRewriteUserPrompt(originalText, analysisJson, options);

    // Use LangChain chatComplete for non-streaming
    const { chatComplete } = await import("../llm/llmClient");
    const rawResponse = await chatComplete(systemPrompt, userPrompt, {
      temperature: 0.4,
      maxTokens: 4000,
      timeoutMs: 30_000,
    });

    if (!rawResponse) {
      throw new Error("No response from rewrite LLM");
    }

    const parsed = parseRewriteResponse(rawResponse);
    const rewriteMs = Date.now() - startTime;

    if (parsed) {
      // Augment LLM scores with heuristic checks
      const heuristicScores = computeHeuristicScores(originalText, parsed.rewritten);
      if (heuristicScores.semanticPreservation !== undefined) {
        parsed.scores.semanticPreservation = Math.round(
          (parsed.scores.semanticPreservation + heuristicScores.semanticPreservation) / 2
        );
      }

      const seo = options.seoOptimize !== "off"
        ? buildSEOInsights(analysis, parsed.rewritten)
        : null;

      return {
        rewritten: parsed.rewritten,
        scores: parsed.scores,
        improvements: parsed.improvements,
        seo,
        metadata: {
          originalWordCount: originalText.split(/\s+/).length,
          rewrittenWordCount: parsed.rewritten.split(/\s+/).length,
          analysisMs: 0, // caller provides this
          rewriteMs,
          totalMs: rewriteMs,
        },
      };
    }

    // Parse failed — return raw text with heuristic scores
    return buildFallbackResult(originalText, rawResponse, rewriteMs, options, analysis);
  } catch (error) {
    const rewriteMs = Date.now() - startTime;
    logger.error("[Humanizer] Rewrite failed", {
      error: (error as Error).message,
      rewriteMs,
    });
    throw error;
  }
}

// ── Main export: streaming ──────────────────────────────────────────────────

/**
 * Rewrite text with streaming. Returns an async iterable of tokens,
 * plus a promise for the final metadata (resolved when the stream ends).
 *
 * Used by the free /api/free/humanize endpoint for progressive frontend rendering.
 */
export async function rewriteTextStream(
  originalText: string,
  analysis: TextAnalysis,
  analysisJson: string,
  options: RewriteOptions,
): Promise<{
  stream: ReadableStream;
  resultPromise: Promise<RewriteResult>;
}> {
  const startTime = Date.now();

  const apiKey = await SecretsService.getOpenAiApiKey();
  const model = process.env.REWRITER_MODEL || "gpt-4o-mini";

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not configured");
  }

  const openaiProvider = createOpenAI({ apiKey });
  const systemPrompt = buildRewriteSystemPrompt(options);
  const userPrompt = buildRewriteUserPrompt(originalText, analysisJson, options);

  // Accumulate the full text for post-processing
  let fullText = "";

  const result = await streamText({
    model: openaiProvider(model),
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
    temperature: 0.4,
    maxTokens: 4000,
    onFinish: async ({ text }) => {
      fullText = text;
    },
  });

  // Create a TransformStream that tees off tokens for both
  // frontend streaming AND full-text accumulation
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // Background: pipe AI SDK stream to our writable, capturing tokens
  (async () => {
    try {
      const aiStream = result.textStream;
      for await (const chunk of aiStream) {
        // Forward to frontend
        await writer.write(encoder.encode(chunk));
      }
    } catch (e) {
      logger.error("[Humanizer] Stream pipe error", { error: (e as Error).message });
    } finally {
      await writer.close();
    }
  })();

  // Promise that resolves with the final metadata after stream completes
  const resultPromise = new Promise<RewriteResult>((resolve, reject) => {
    // Poll for completion (the AI SDK's onFinish sets fullText)
    const checkComplete = () => {
      // Wait for the AI SDK to finish
      result.consumeStream().then(() => {
        const rewriteMs = Date.now() - startTime;
        const parsed = fullText ? parseRewriteResponse(fullText) : null;

        if (parsed) {
          const heuristicScores = computeHeuristicScores(originalText, parsed.rewritten);
          if (heuristicScores.semanticPreservation !== undefined) {
            parsed.scores.semanticPreservation = Math.round(
              (parsed.scores.semanticPreservation + heuristicScores.semanticPreservation) / 2
            );
          }

          const seo = options.seoOptimize !== "off"
            ? buildSEOInsights(analysis, parsed.rewritten)
            : null;

          resolve({
            rewritten: parsed.rewritten,
            scores: parsed.scores,
            improvements: parsed.improvements,
            seo,
            metadata: {
              originalWordCount: originalText.split(/\s+/).length,
              rewrittenWordCount: parsed.rewritten.split(/\s+/).length,
              analysisMs: 0,
              rewriteMs,
              totalMs: rewriteMs,
            },
          });
        } else {
          // Parse failed
          resolve(
            buildFallbackResult(originalText, fullText, rewriteMs, options, analysis)
          );
        }
      }).catch(reject);
    };

    // Give the stream a moment to finish, then check
    setTimeout(checkComplete, 100);
  });

  return { stream: readable, resultPromise };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function buildFallbackResult(
  originalText: string,
  rewrittenText: string,
  rewriteMs: number,
  options: RewriteOptions,
  analysis: TextAnalysis,
): RewriteResult {
  const heuristicScores = computeHeuristicScores(originalText, rewrittenText);
  const issues = detectQualityIssues(rewrittenText);

  return {
    rewritten: rewrittenText,
    scores: {
      semanticPreservation: heuristicScores.semanticPreservation ?? 70,
      factualConsistency: 85,
      readability: 75,
      naturalness: heuristicScores.naturalness ?? 70,
      structure: 75,
      topicalCoverage: 70,
      overallQuality: 73,
    },
    improvements: [
      ...issues.map((i) => `Detected: ${i.description}`),
      "Rewritten by fallback (JSON parse failed)",
    ],
    seo: options.seoOptimize !== "off" ? buildSEOInsights(analysis, rewrittenText) : null,
    metadata: {
      originalWordCount: originalText.split(/\s+/).length,
      rewrittenWordCount: rewrittenText.split(/\s+/).length,
      analysisMs: 0,
      rewriteMs,
      totalMs: rewriteMs,
    },
  };
}
