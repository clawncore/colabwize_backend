/**
 * Stage 1: Text Analysis Engine
 *
 * Single LLM call that extracts structured data from the input text:
 * - Topic, intent, language
 * - Entities and factual claims
 * - Keywords and their placement
 * - Style profile (formality, complexity, etc.)
 * - Quality issues (repetition, filler, passive voice, etc.)
 * - SEO signals (search intent, topic gaps, etc.)
 *
 * Uses gpt-4o-mini for cost efficiency. The analysis feeds directly
 * into the rewrite prompt as context.
 */

import { chatComplete } from "../llm/llmClient";
import { heuristicAnalyze } from "./heuristics";
import { ANALYSIS_SYSTEM_PROMPT, buildAnalysisUserPrompt } from "./prompts";
import type { TextAnalysis } from "./types";
import logger from "../../monitoring/logger";

// ── Default/fallback analysis when LLM fails ────────────────────────────────

function buildFallbackAnalysis(text: string): TextAnalysis {
  const h = heuristicAnalyze(text);
  const sentences = text.split(/[.!?]+\s+/).filter((s) => s.trim().length > 0);
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 0);

  return {
    topic: "unknown",
    intent: "general",
    language: detectLanguage(text),
    sentenceCount: sentences.length,
    paragraphCount: paragraphs.length,
    entities: [],
    claims: [],
    keywords: [],
    styleProfile: {
      formality: 50,
      sentenceVariation: h.sentenceLengthVariance > 5 ? 70 : 40,
      vocabularyComplexity: 50,
      directness: 50,
      technicality: 50,
    },
    qualityIssues: [
      ...h.fillerPhrases.slice(0, 3).map((phrase) => ({
        type: "filler" as const,
        description: `Contains filler: "${phrase}"`,
        severity: "medium" as const,
      })),
      ...(h.sentenceLengthVariance < 3 && h.sentenceLengths.length > 3
        ? [
            {
              type: "uniform_rhythm" as const,
              description: "Sentences have similar length (uniform rhythm)",
              severity: "medium" as const,
            },
          ]
        : []),
    ],
    seo: {
      searchIntent: "informational",
      primaryTopic: "",
      relatedConcepts: [],
      topicGaps: [],
      entityCoverage: 50,
    },
  };
}

function detectLanguage(text: string): string {
  // Simple heuristic: check for common words
  const sample = text.slice(0, 500).toLowerCase();
  if (/\b(the|and|that|this|with)\b/.test(sample)) return "English";
  if (/\b(le|la|les|des|une|est|sont)\b/.test(sample)) return "French";
  if (/\b(el|la|los|las|es|son|una)\b/.test(sample)) return "Spanish";
  if (/\b(der|die|das|ein|eine|ist|sind)\b/.test(sample)) return "German";
  return "English";
}

// ── LLM-based analysis ──────────────────────────────────────────────────────

/**
 * Parse the LLM's JSON response into a TextAnalysis.
 * Handles common issues: markdown code blocks, trailing commas, etc.
 */
function parseAnalysisResponse(raw: string): TextAnalysis | null {
  try {
    // Strip markdown code blocks if present
    let cleaned = raw.trim();
    if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
    if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
    if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
    cleaned = cleaned.trim();

    // Remove trailing commas (common LLM output issue)
    cleaned = cleaned.replace(/,\s*([\]}])/g, "$1");

    const parsed = JSON.parse(cleaned);

    // Validate required fields exist
    if (!parsed.topic && !parsed.styleProfile && !parsed.qualityIssues) {
      return null;
    }

    // Normalize and fill defaults
    return {
      topic: parsed.topic || "unknown",
      intent: parsed.intent || "general",
      language: parsed.language || "English",
      sentenceCount: parsed.sentenceCount || 0,
      paragraphCount: parsed.paragraphCount || 0,
      entities: Array.isArray(parsed.entities) ? parsed.entities : [],
      claims: Array.isArray(parsed.claims) ? parsed.claims : [],
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
      styleProfile: {
        formality: clamp(parsed.styleProfile?.formality ?? 50),
        sentenceVariation: clamp(parsed.styleProfile?.sentenceVariation ?? 50),
        vocabularyComplexity: clamp(parsed.styleProfile?.vocabularyComplexity ?? 50),
        directness: clamp(parsed.styleProfile?.directness ?? 50),
        technicality: clamp(parsed.styleProfile?.technicality ?? 50),
      },
      qualityIssues: Array.isArray(parsed.qualityIssues)
        ? parsed.qualityIssues.map((issue: any) => ({
            type: issue.type || "awkward_phrasing",
            description: issue.description || "",
            severity: ["high", "medium", "low"].includes(issue.severity)
              ? issue.severity
              : "medium",
            location: issue.location,
          }))
        : [],
      seo: {
        searchIntent: parsed.seo?.searchIntent || "informational",
        primaryTopic: parsed.seo?.primaryTopic || "",
        relatedConcepts: Array.isArray(parsed.seo?.relatedConcepts)
          ? parsed.seo.relatedConcepts
          : [],
        topicGaps: Array.isArray(parsed.seo?.topicGaps)
          ? parsed.seo.topicGaps
          : [],
        entityCoverage: clamp(parsed.seo?.entityCoverage ?? 50),
      },
    };
  } catch (e) {
    logger.warn("[Humanizer] Failed to parse analysis JSON", {
      error: (e as Error).message,
      rawPreview: raw.slice(0, 200),
    });
    return null;
  }
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

// ── Main export ─────────────────────────────────────────────────────────────

/**
 * Analyze text using LLM (Stage 1 of the pipeline).
 * Falls back to heuristic analysis if LLM fails.
 *
 * @returns TextAnalysis + the raw JSON string (for passing to rewrite prompt)
 */
export async function analyzeText(
  text: string,
): Promise<{ analysis: TextAnalysis; analysisJson: string }> {
  const startTime = Date.now();

  try {
    const userPrompt = buildAnalysisUserPrompt(text);
    const rawResponse = await chatComplete(ANALYSIS_SYSTEM_PROMPT, userPrompt, {
      temperature: 0.2, // Low temperature for consistent analysis
      maxTokens: 2000,
      timeoutMs: 20_000,
    });

    if (!rawResponse) {
      throw new Error("No response from analysis LLM");
    }

    const parsed = parseAnalysisResponse(rawResponse);

    if (!parsed) {
      throw new Error("Failed to parse analysis response");
    }

    // Fill sentence/paragraph counts from heuristic if LLM didn't provide them
    if (parsed.sentenceCount === 0) {
      const h = heuristicAnalyze(text);
      parsed.sentenceCount = h.sentenceLengths.length;
      parsed.paragraphCount = text.split(/\n\n+/).filter((p) => p.trim().length > 0).length;
    }

    const elapsed = Date.now() - startTime;
    logger.info("[Humanizer] Analysis complete", {
      elapsed,
      topic: parsed.topic,
      issuesFound: parsed.qualityIssues.length,
      entitiesFound: parsed.entities.length,
    });

    return {
      analysis: parsed,
      // Pass the raw JSON to the rewrite prompt for full context
      analysisJson: rawResponse,
    };
  } catch (error) {
    const elapsed = Date.now() - startTime;
    logger.warn("[Humanizer] LLM analysis failed, using heuristic fallback", {
      error: (error as Error).message,
      elapsed,
    });

    const fallback = buildFallbackAnalysis(text);
    // Serialize fallback as JSON for the rewrite prompt
    return {
      analysis: fallback,
      analysisJson: JSON.stringify(fallback, null, 2),
    };
  }
}
