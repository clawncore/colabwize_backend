/**
 * Humanizer Pipeline Orchestrator
 *
 * Coordinates the two-stage pipeline:
 * 1. Text Analysis (LLM or heuristic fallback)
 * 2. Rewrite Engine (streaming LLM or local fallback)
 *
 * Emits SSE events for progressive frontend rendering.
 * Handles graceful degradation at every stage.
 */

import { analyzeText } from "./analysis";
import { rewriteTextStream, rewriteTextSync } from "./rewrite";
import { heuristicAnalyze } from "./heuristics";
import { HumanizerService } from "../humanizerService";
import type {
  RewriteOptions,
  RewriteResult,
  PipelineEvent,
  HumanizeRequest,
} from "./types";
import { DEFAULT_OPTIONS } from "./types";
import logger from "../../monitoring/logger";

// ── SSE helper ──────────────────────────────────────────────────────────────

function sseEvent(event: PipelineEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

// ── Main pipeline ───────────────────────────────────────────────────────────

/**
 * Run the full humanization pipeline with SSE streaming.
 * Returns a ReadableStream of SSE events.
 *
 * Event types:
 * - progress: pipeline stage updates
 * - token: streamed text tokens
 * - complete: final result with scores
 * - error: error messages
 */
export function runHumanizationPipeline(
  text: string,
  requestOptions: HumanizeRequest,
): ReadableStream {
  const options: RewriteOptions = {
    mode: requestOptions.mode || DEFAULT_OPTIONS.mode,
    style: requestOptions.style || DEFAULT_OPTIONS.style,
    seoOptimize: requestOptions.seoOptimize || DEFAULT_OPTIONS.seoOptimize,
    preserveStructure: requestOptions.preserveStructure ?? DEFAULT_OPTIONS.preserveStructure,
    preserveKeywords: requestOptions.preserveKeywords ?? DEFAULT_OPTIONS.preserveKeywords,
    preserveTerminology: requestOptions.preserveTerminology ?? DEFAULT_OPTIONS.preserveTerminology,
  };

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const emit = async (event: PipelineEvent) => {
    try {
      await writer.write(encoder.encode(sseEvent(event)));
    } catch {
      // Client disconnected — stop emitting
    }
  };

  // Run the pipeline asynchronously
  (async () => {
    const totalStart = Date.now();
    let analysisMs = 0;
    let rewriteMs = 0;

    try {
      // ── Stage 1: Analysis ────────────────────────────────────────────
      await emit({
        type: "progress",
        stage: "analyzing",
        label: "Analyzing text structure and style...",
      });

      const analysisStart = Date.now();
      let analysisJson: string;

      try {
        const { analysis, analysisJson: json } = await analyzeText(text);
        analysisJson = json;
        analysisMs = Date.now() - analysisStart;

        await emit({
          type: "progress",
          stage: "analyzing",
          label: `Analysis complete — found ${analysis.qualityIssues.length} quality issues`,
        });
      } catch (analysisError) {
        analysisMs = Date.now() - analysisStart;
        logger.warn("[Humanizer] Analysis stage failed, using heuristic fallback", {
          error: (analysisError as Error).message,
        });

        const h = heuristicAnalyze(text);
        analysisJson = JSON.stringify(h);

        await emit({
          type: "progress",
          stage: "analyzing",
          label: "Using basic text analysis (advanced analysis unavailable)",
          warning: "SEO insights limited",
        });
      }

      // ── Stage 2: Rewrite ─────────────────────────────────────────────
      await emit({
        type: "progress",
        stage: "rewriting",
        label: `Rewriting in ${options.style} style...`,
      });

      const rewriteStart = Date.now();

      try {
        // Try streaming rewrite
        const { stream, resultPromise } = await rewriteTextStream(
          text,
          await parseAnalysisForRewrite(analysisJson),
          analysisJson,
          options,
        );

        // Pipe the rewrite stream as SSE token events
        const reader = stream.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          // Each chunk might contain JSON parse errors — the client handles that
          await emit({ type: "token", text: chunk });
        }

        rewriteMs = Date.now() - rewriteStart;

        // Get final result
        const result = await resultPromise;
        result.metadata.analysisMs = analysisMs;
        result.metadata.rewriteMs = rewriteMs;
        result.metadata.totalMs = Date.now() - totalStart;

        await emit({
          type: "progress",
          stage: "complete",
          label: `Done in ${(result.metadata.totalMs / 1000).toFixed(1)}s`,
        });

        await emit({ type: "complete", result });
      } catch (rewriteError) {
        rewriteMs = Date.now() - rewriteStart;
        logger.warn("[Humanizer] Streaming rewrite failed, trying sync fallback", {
          error: (rewriteError as Error).message,
        });

        // Fallback: non-streaming rewrite
        try {
          const parsedAnalysis = await parseAnalysisForRewrite(analysisJson);
          const result = await rewriteTextSync(text, parsedAnalysis, analysisJson, options);
          result.metadata.analysisMs = analysisMs;
          result.metadata.rewriteMs = Date.now() - rewriteStart;
          result.metadata.totalMs = Date.now() - totalStart;

          // Send the full text as a single token
          await emit({ type: "token", text: result.rewritten });
          await emit({
            type: "progress",
            stage: "complete",
            label: `Done in ${(result.metadata.totalMs / 1000).toFixed(1)}s (non-streaming)`,
          });
          await emit({ type: "complete", result });
        } catch (syncError) {
          // Both LLM paths failed — use local heuristic
          logger.warn("[Humanizer] All LLM paths failed, using local heuristic", {
            error: (syncError as Error).message,
          });

          const localResult = await HumanizerService.humanizeText(text);
          const fallbackText = localResult.variations[0] || text;

          const totalMs = Date.now() - totalStart;
          const fallbackResult: RewriteResult = {
            rewritten: fallbackText,
            scores: {
              semanticPreservation: 70,
              factualConsistency: 90,
              readability: 65,
              naturalness: 60,
              structure: 70,
              topicalCoverage: 50,
              overallQuality: 65,
            },
            improvements: ["Applied local text transformations (AI unavailable)"],
            seo: null,
            metadata: {
              originalWordCount: text.split(/\s+/).length,
              rewrittenWordCount: fallbackText.split(/\s+/).length,
              analysisMs,
              rewriteMs: 0,
              totalMs,
            },
          };

          await emit({ type: "token", text: fallbackText });
          await emit({
            type: "progress",
            stage: "complete",
            label: "Completed with local fallback (AI unavailable)",
            warning: "AI-powered rewriting temporarily unavailable",
          });
          await emit({ type: "complete", result: fallbackResult });
        }
      }
    } catch (error) {
      const totalMs = Date.now() - totalStart;
      logger.error("[Humanizer] Pipeline failed", {
        error: (error as Error).message,
        totalMs,
      });

      await emit({
        type: "error",
        message: "Humanization failed. Please try again.",
        stage: "error",
      });
    } finally {
      await writer.close();
    }
  })();

  return readable;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse the analysis JSON string back into a TextAnalysis object.
 * Used to pass structured analysis to the rewrite stage.
 */
async function parseAnalysisForRewrite(jsonStr: string): Promise<import("./types").TextAnalysis> {
  try {
    return JSON.parse(jsonStr);
  } catch {
    // Return minimal analysis
    return {
      topic: "unknown",
      intent: "general",
      language: "English",
      sentenceCount: 0,
      paragraphCount: 0,
      entities: [],
      claims: [],
      keywords: [],
      styleProfile: {
        formality: 50,
        sentenceVariation: 50,
        vocabularyComplexity: 50,
        directness: 50,
        technicality: 50,
      },
      qualityIssues: [],
      seo: {
        searchIntent: "informational",
        primaryTopic: "",
        relatedConcepts: [],
        topicGaps: [],
        entityCoverage: 50,
      },
    };
  }
}
