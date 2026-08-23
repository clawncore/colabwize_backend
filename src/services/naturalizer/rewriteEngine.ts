/**
 * Academic Writing Naturalizer — adversarial iterative rewrite engine.
 *
 * Pipeline per request:
 *   1. preprocess()      mask protected entities (citations/numbers/URLs…)
 *   2. analyzeText()     cheap structural stats for transparency
 *   3. iterate           rewrite masked text via LLM, bounded by MAX_ITERATIONS
 *   4. restore()         put protected entities back verbatim
 *   5. validate()        hard integrity gates (citations/numbers/homoglyphs)
 *   6. accept or retry   rejected candidates feed their warnings back into
 *                        the next attempt's prompt
 *
 * Integrity policy: FACTUAL INTEGRITY outranks everything else. If no
 * candidate passes validation within the iteration budget we do NOT return
 * the least-bad rewrite — we return the original untouched with an explicit
 * failure note, so a broken output can never silently ship.
 *
 * This tool optimizes for better academic writing + semantic fidelity +
 * verifiable integrity. It deliberately does NOT optimize for evading AI
 * detectors — no Unicode tricks, no injected spelling errors, no random
 * synonym noise.
 */

import { chatComplete } from "../llm/llmClient";
import { compareTwoStrings } from "string-similarity";
import logger from "../../monitoring/logger";
import {
  PreprocessedText,
  preprocess,
  restore,
  validateIntegrity,
} from "./protectedEntities";
import { ValidationReport, validate } from "./validators";

// ── Public types ─────────────────────────────────────────────────────────────

export type IntensityMode = "light" | "moderate" | "strong";

export const MAX_INPUT_CHARS = 12_000;
export const MAX_ITERATIONS = 3;

export interface TextStats {
  words: number;
  sentences: number;
  avgSentenceLength: number;
  longSentenceRatio: number; // share of sentences > 30 words
  lexicalOverlap: number;   // Dice coefficient vs original (0..1)
}

export interface IterationLog {
  iteration: number;
  accepted: boolean;
  warnings: string[];
}

export interface NaturalizeResult {
  original: string;
  naturalized: string;
  provider: "openai" | "local";
  mode: IntensityMode;
  discipline: string;
  iterationsUsed: number;
  maxIterations: number;
  passedValidation: boolean;
  validation: ValidationReport;
  entityCounts: Record<string, number>;
  stats: { original: TextStats; rewritten: TextStats };
  iterations: IterationLog[];
  notes: string[];
}

// ── Discipline presets ───────────────────────────────────────────────────────

const DISCIPLINES: Record<string, string> = {
  general: "",
  stem: "Terminology: keep established technical terms exact; prefer active voice for methods ('we measured' over 'it was measured').",
  medicine:
    "Terminology: use standard clinical/anatomical terms; keep drug names, dosages and trial phases untouched; hedging language ('may', 'is associated with') must survive.",
  law: "Terminology: preserve legal terms of art verbatim; never paraphrase statute names or case names.",
  humanities:
    "Terminology: respect field-specific interpretive vocabulary; preserve quotations exactly.",
  socialscience:
    "Terminology: keep construct names, scale names and statistical conventions (p, r, N) untouched.",
};

const MODE_GUIDANCE: Record<IntensityMode, string> = {
  light:
    "Intensity LIGHT: make minimal edits — smooth awkward phrasing and fix AI-typical patterns. Most sentences stay recognizable.",
  moderate:
    "Intensity MODERATE: rephrase most sentences; you may merge or split adjacent short sentences. Paragraph order and all claims stay fixed.",
  strong:
    "Intensity STRONG: deep restructuring allowed — reorder clauses within sentences, vary rhythm aggressively — provided every claim, hedge, and [PLACEHOLDER] survives intact.",
};

// ── Analysis helpers ─────────────────────────────────────────────────────────

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z"'(\[])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function computeStats(text: string, reference?: string): TextStats {
  const sentences = splitSentences(text);
  const words = text.split(/\s+/).filter(Boolean).length;
  const longSentences = sentences.filter(
    (s) => s.split(/\s+/).filter(Boolean).length > 30,
  ).length;

  return {
    words,
    sentences: sentences.length,
    avgSentenceLength: sentences.length ? Math.round(words / sentences.length) : 0,
    longSentenceRatio: sentences.length ? longSentences / sentences.length : 0,
    lexicalOverlap: reference ? compareTwoStrings(reference, text) : 0,
  };
}

/** Cheap structural read of the input — powers /analyze and the UI panel. */
export function analyzeText(text: string): TextStats {
  return computeStats(text);
}

// ── Prompting ────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT_BASE = `You are a senior academic copy editor. Rewrite the user's text so it reads as clear, natural scholarly prose while preserving meaning exactly.

HARD CONSTRAINTS — violating any single one voids your output:
1. Keep every bracketed token such as [NUMBER_001] or [CITATION_002] EXACTLY as written: same characters, same position in its sentence, same count. Never rename, reorder, merge, drop or invent them.
2. Never add facts, claims, citations, examples or interpretations not present in the source.
3. Preserve every claim, every hedge ("may", "suggests", "appears to"), and the author's stance toward the evidence.
4. Use only characters that appear in the source plus ordinary ASCII punctuation. No special Unicode symbols.
5. Match the source's paragraph structure. No lists, headings, bold, or markdown.
6. Return ONLY the rewritten prose — no preamble, no explanation, no quotation wrapper.

STYLE GOALS:
- Vary sentence length and openings; break up monotonous constructions.
- Prefer precise verbs over heavy nominalizations ("we analyzed" not "an analysis was conducted").
- Formal academic register; remove AI-flavored filler ("It is important to note that", chains of "Moreover/Furthermore").`;

function buildSystemPrompt(mode: IntensityMode, discipline: string): string {
  const guidance = DISCIPLINES[discipline] || "";
  return `${SYSTEM_PROMPT_BASE}\n\n${MODE_GUIDANCE[mode]}${guidance ? `\n${guidance}` : ""}`;
}

// ── Local fallback (deterministic, meaning-preserving) ───────────────────────

const CONNECTIVE_SWAPS: Array<[RegExp, string]> = [
  [/\bMoreover,\s/g, "Beyond that, "],
  [/\bFurthermore,\s/g, "In addition, "],
  [/\bAdditionally,\s/g, "Also, "],
];

const CONTRACTION_EXPANSIONS: Array<[RegExp, string]> = [
  [/\bdon't\b/g, "do not"],
  [/\bdoesn't\b/g, "does not"],
  [/\bisn't\b/g, "is not"],
  [/\baren't\b/g, "are not"],
  [/\bwon't\b/g, "will not"],
  [/\bcan't\b/g, "cannot"],
  [/\bit's\b/g, "it is"],
  [/\bthey're\b/g, "they are"],
];

/**
 * Deterministic light-touch transform used when no LLM is configured.
 * Only meaning-preserving mechanical edits — explicitly NOT synonym noise.
 */
function localNaturalize(masked: string): string {
  let out = masked;
  for (const [re, replacement] of CONTRACTION_EXPANSIONS) out = out.replace(re, replacement);
  // Swap at most one connective per paragraph start to keep it subtle.
  for (const [re, replacement] of CONNECTIVE_SWAPS) out = out.replace(re, replacement);
  return out;
}

// ── Core engine ──────────────────────────────────────────────────────────────

interface Candidate {
  text: string;
  validation: ValidationReport;
}

function scoreCandidate(c: Candidate): number {
  // Lower is better: count violated gates, weight warnings as tiebreakers.
  const gatesFailed =
    (c.validation.citationIntegrity ? 0 : 1) +
    (c.validation.numericalIntegrity ? 0 : 1) +
    (c.validation.placeholderIntegrity ? 0 : 1);
  return gatesFailed * 100 + c.validation.warnings.length;
}

export async function naturalize(options: {
  text: string;
  mode?: IntensityMode;
  discipline?: string;
}): Promise<NaturalizeResult> {
  const mode: IntensityMode = options.mode || "moderate";
  const discipline = options.discipline && DISCIPLINES[options.discipline]
    ? options.discipline
    : "general";
  const notes: string[] = [];
  const iterationLogs: IterationLog[] = [];

  const pre: PreprocessedText = preprocess(options.text);

  // Attempt the LLM path first.
  const systemPrompt = buildSystemPrompt(mode, discipline);
  let workingText = pre.masked;
  let bestCandidate: Candidate | null = null;
  let provider: "openai" | "local" = "local";

  for (let i = 1; i <= MAX_ITERATIONS; i++) {
    const feedback =
      bestCandidate && !bestCandidate.validation.ok
        ? `\n\nYour previous attempt was REJECTED by our integrity checker:\n- ${bestCandidate.validation.warnings.join("\n- ")}\nProduce a new rewrite fixing exactly these problems.`
        : "";

    const raw = await chatComplete(systemPrompt, workingText + feedback, {
      temperature: mode === "light" ? 0.3 : 0.5,
      maxTokens: Math.min(4000, Math.ceil(pre.masked.length * 1.6)),
      timeoutMs: 45_000,
    });

    if (!raw) {
      // No API key or call failed — leave the loop, use local fallback below.
      notes.push("LLM unavailable; used deterministic local editing instead.");
      break;
    }

    provider = "openai";

    // Strip a possible accidental code fence / "Here is ..." wrapper.
    const cleaned = raw
      .replace(/^```[a-z]*\n?|```$/gm, "")
      .replace(/^(here(?:'s| is)[^:\n]*:\s*)/i, "")
      .trim();

    // Placeholder integrity is checked BEFORE restoration: once placeholders
    // are swapped back for their originals they no longer exist in the text,
    // so a post-restore placeholder scan would always "fail".
    const preRestoreCheck = validateIntegrity(cleaned, pre.entities);
    const restored = restore(cleaned, pre.entities);
    // Post-restoration we gate on citations/numbers/homoglyphs only.
    const validation = validate(options.text, restored, []);
    if (!preRestoreCheck.ok) {
      const dropped = preRestoreCheck.missing.map((m) => m.placeholder).join(", ");
      validation.ok = false;
      validation.placeholderIntegrity = false;
      validation.warnings.push(`Protected elements dropped by rewriter: ${dropped}`);
    }

    iterationLogs.push({ iteration: i, accepted: validation.ok, warnings: validation.warnings });

    const candidate: Candidate = { text: restored, validation };
    if (!bestCandidate || scoreCandidate(candidate) < scoreCandidate(bestCandidate)) {
      bestCandidate = candidate;
    }
    if (validation.ok) break;
  }

  // Resolve the outcome.
  if (bestCandidate && bestCandidate.validation.ok) {
    return buildResult({
      original: options.text,
      naturalized: bestCandidate.text,
      provider,
      mode,
      discipline,
      iterationsUsed: iterationLogs.length,
      validation: bestCandidate.validation,
      pre,
      iterationLogs,
      notes,
    });
  }

  // LLM path exhausted without passing — try deterministic local edit.
  const localOut = restore(localNaturalize(pre.masked), pre.entities);
  const localValidation = validate(options.text, localOut, pre.entities);
  if (localValidation.ok) {
    notes.push("No integrity-safe LLM rewrite produced; returned conservatively edited text.");
    return buildResult({
      original: options.text,
      naturalized: localOut,
      provider: "local",
      mode,
      discipline,
      iterationsUsed: iterationLogs.length,
      validation: localValidation,
      pre,
      iterationLogs,
      notes,
    });
  }

  // Even the local edit violates something (pathological input) — refuse.
  notes.push(
    "Could not produce an integrity-safe rewrite; returning the original text unchanged.",
  );
  return buildResult({
    original: options.text,
    naturalized: options.text,
    provider: "local",
    mode,
    discipline,
    iterationsUsed: iterationLogs.length,
    validation: bestCandidate?.validation ?? localValidation,
    pre,
    iterationLogs,
    notes,
  });
}

function buildResult(args: {
  original: string;
  naturalized: string;
  provider: "openai" | "local";
  mode: IntensityMode;
  discipline: string;
  iterationsUsed: number;
  validation: ValidationReport;
  pre: PreprocessedText;
  iterationLogs: IterationLog[];
  notes: string[];
}): NaturalizeResult {
  logger.info("[Naturalizer] rewrite complete", {
    provider: args.provider,
    mode: args.mode,
    iterations: args.iterationsUsed,
    passed: args.validation.ok,
    warnings: args.validation.warnings.length,
  });

  return {
    original: args.original,
    naturalized: args.naturalized,
    provider: args.provider,
    mode: args.mode,
    discipline: args.discipline,
    iterationsUsed: args.iterationsUsed,
    maxIterations: MAX_ITERATIONS,
    passedValidation: args.validation.ok,
    validation: args.validation,
    entityCounts: args.pre.counts as unknown as Record<string, number>,
    stats: {
      original: computeStats(args.original),
      rewritten: computeStats(args.naturalized, args.original),
    },
    iterations: args.iterationLogs,
    notes: args.notes,
  };
}
