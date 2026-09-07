/**
 * Prompt templates for the Humanizer writing transformation pipeline.
 *
 * Two prompts, two responsibilities:
 * 1. ANALYSIS_PROMPT — extract structured data from input text (Stage 1)
 * 2. REWRITE_PROMPT — transform text using analysis context (Stage 2)
 *
 * Neither prompt instructs the model to evade AI detectors.
 * Both optimize for genuine writing quality.
 */

import type { RewriteOptions } from "./types";

// ── Stage 1: Analysis Prompt ────────────────────────────────────────────────

export const ANALYSIS_SYSTEM_PROMPT = `You are a precise text analysis engine for academic and professional writing. Your ONLY job is to analyze the input text and return a structured JSON object. Do NOT rewrite, paraphrase, or modify the text in any way.

Analyze the text for:

1. TOPIC & INTENT: What is the text about? What is its purpose?
2. LANGUAGE: Primary language of the text.
3. ENTITIES: Named entities (people, organizations, locations, concepts, citations).
4. CLAIMS: Key factual claims with their importance level, associated numbers, and dates.
5. KEYWORDS: Important terms, their frequency, and where they appear (intro/body/conclusion).
6. STYLE PROFILE: Rate these qualities 0-100:
   - formality (0=very informal, 100=very formal)
   - sentenceVariation (0=uniform length, 100=highly varied)
   - vocabularyComplexity (0=simple, 100=complex)
   - directness (0=very hedged, 100=very direct)
   - technicality (0=general, 100=highly technical)
7. QUALITY ISSUES: Identify specific problems:
   - repetition (same words/phrases used repeatedly)
   - filler (unnecessary phrases like "it is important to note")
   - passive_voice (overuse of passive constructions)
   - uniform_rhythm (sentences of similar length)
   - awkward_phrasing (unnatural or clunky sentences)
   - excessive_hedging (too many qualifiers)
   - weak_transitions (poor flow between ideas)
8. SEO SIGNALS:
   - searchIntent (informational/commercial/transactional/how-to/problem-solving)
   - primaryTopic
   - relatedConcepts (related topics not covered)
   - topicGaps (important aspects missing)
   - entityCoverage (0-100, how well entities are covered)

Return ONLY valid JSON matching this exact schema. No markdown, no explanation.`;

export function buildAnalysisUserPrompt(text: string): string {
  return `Analyze the following text and return the structured JSON analysis:

---
${text}
---

Return ONLY the JSON object. No preamble, no markdown code blocks.`;
}

// ── Stage 2: Rewrite Prompt ─────────────────────────────────────────────────

const MODE_INSTRUCTIONS: Record<string, string> = {
  humanize: `Rewrite the text to read like natural, skilled human writing.
- Fix the identified quality issues (repetition, filler, passive voice, uniform rhythm)
- Vary sentence length and openings
- Improve transitions between ideas
- Remove unnecessary hedging and filler phrases
- Strengthen weak sentences
- Keep the author's voice and intent intact`,

  humanize_seo: `Rewrite the text for natural readability AND search relevance.
- Apply all humanize improvements
- Naturally incorporate related concepts from the SEO analysis
- Ensure the primary topic is clearly established early
- Use semantic variants of key terms (not repetition)
- Improve topical coverage where gaps were identified
- Do NOT stuff keywords — weave them naturally`,

  seo_optimize: `Optimize the text for search visibility while preserving quality.
- Restructure for clarity and scannability if it improves readability
- Ensure strong topical coverage
- Place key terms naturally in high-value positions (early paragraph, topic sentences)
- Improve heading structure if applicable
- Maintain factual accuracy throughout
- Do NOT sacrifice writing quality for SEO`,

  improve_writing: `Improve the overall writing quality.
- Fix grammar and clarity issues
- Strengthen sentence structure
- Improve word choice (replace vague or weak words)
- Enhance paragraph flow and transitions
- Tighten prose — remove redundancy
- Preserve the author's voice and all factual content`,
};

const STYLE_INSTRUCTIONS: Record<string, string> = {
  natural: "Write in a natural, everyday voice. Contractions are fine. Keep it readable and clear.",
  professional: "Write in a professional, polished tone. Formal but not stiff. Clear and confident.",
  academic: "Write in precise academic prose. Use discipline-appropriate vocabulary. Maintain scholarly rigor.",
  conversational: "Write in a warm, approachable tone. As if explaining to a knowledgeable colleague.",
  technical: "Write with technical precision. Use domain-specific terminology accurately. Be concise and exact.",
  simple: "Write in plain, simple language. Short sentences. Common vocabulary. Maximum clarity.",
};

export function buildRewriteSystemPrompt(options: RewriteOptions): string {
  const modeInstruction = MODE_INSTRUCTIONS[options.mode] || MODE_INSTRUCTIONS.humanize;
  const styleInstruction = STYLE_INSTRUCTIONS[options.style] || STYLE_INSTRUCTIONS.natural;

  const seoSection = options.seoOptimize !== "off"
    ? `\n\nSEO OPTIMIZATION LEVEL: ${options.seoOptimize}
${options.seoOptimize === "strong" ? "Actively optimize for search visibility. Prioritize topical completeness and keyword placement." : "Balance SEO with natural reading flow. Don't force keywords."}`
    : "";

  const preserveSection = `
FACTUAL PRESERVATION RULES (NON-NEGOTIABLE):
- Every number, date, percentage, and measurement must appear exactly as in the original
- Every proper noun (person, organization, product, location) must be preserved exactly
- Every citation, reference, DOI, URL, and bibliographic element must be untouched
- Every quoted material must remain verbatim
- Technical/scientific terminology must not be simplified or replaced
- Logical relationships between claims must be preserved
- Do NOT invent facts, numbers, dates, or references that aren't in the original`;

  const structureNote = options.preserveStructure
    ? "\n\nSTRUCTURE: Preserve the original paragraph structure and ordering. Improve within paragraphs, don't reorganize them."
    : "\n\nSTRUCTURE: You may reorganize paragraphs and sections if it improves readability and flow.";

  return `You are an expert academic editor and writing specialist. Your task is to transform the provided text into genuinely better writing.

MODE: ${modeInstruction}

STYLE: ${styleInstruction}
${seoSection}
${preserveSection}
${structureNote}

OUTPUT FORMAT:
Return a JSON object with this exact structure:
{
  "rewritten": "The full rewritten text here",
  "scores": {
    "semanticPreservation": <0-100>,
    "factualConsistency": <0-100>,
    "readability": <0-100>,
    "naturalness": <0-100>,
    "structure": <0-100>,
    "topicalCoverage": <0-100>
  },
  "improvements": ["List of specific improvements made"]
}

Be honest in your scores. A 95+ means near-perfect. Most good rewrites score 75-90.
Return ONLY the JSON object. No markdown, no explanation.`;
}

export function buildRewriteUserPrompt(
  originalText: string,
  analysisJson: string,
  options: RewriteOptions,
): string {
  const seoContext = options.seoOptimize !== "off"
    ? `\n\nSEO ANALYSIS:\n${analysisJson}`
    : "";

  return `Rewrite the following text according to the instructions.

ORIGINAL TEXT:
---
${originalText}
---

TEXT ANALYSIS:${seoContext}

Apply the quality improvements identified in the analysis. Fix repetition, filler, passive voice, and rhythm issues. Preserve all factual content exactly.

Return ONLY the JSON object with rewritten text, scores, and improvements.`;
}
