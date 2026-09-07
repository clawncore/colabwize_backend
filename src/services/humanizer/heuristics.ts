/**
 * Heuristic text analysis and post-processing utilities.
 *
 * Used in two contexts:
 * 1. Fallback analysis when the LLM analysis call fails
 * 2. Post-processing validation after rewriting
 *
 * These are fast, deterministic, zero-cost checks that complement
 * the LLM-based analysis.
 */

import type { HeuristicAnalysis, QualityIssue } from "./types";

// ── Common filler phrases (academic / machine-writing tells) ─────────────────

const FILLER_PHRASES = [
  "it is important to note that",
  "it should be noted that",
  "it is worth noting that",
  "as a matter of fact",
  "in today's society",
  "in the realm of",
  "delve into",
  "at the end of the day",
  "when it comes to",
  "in terms of",
  "with regard to",
  "in relation to",
  "it goes without saying",
  "needless to say",
  "as we all know",
  "in light of the fact that",
  "due to the fact that",
  "in order to",
  "for the purpose of",
  "on a daily basis",
  "in the process of",
  "make use of",
  "give rise to",
  "take into consideration",
  "a great deal of",
  "the vast majority of",
  "in this day and age",
];

// ── Common transition crutch words ──────────────────────────────────────────

const TRANSITION_CRUTCHES = [
  "moreover",
  "furthermore",
  "additionally",
  "consequently",
  "nevertheless",
  "nonetheless",
  "henceforth",
  "subsequently",
  "respectively",
  "notwithstanding",
];

// ── Sentence splitting ──────────────────────────────────────────────────────

function splitSentences(text: string): string[] {
  // Split on sentence-ending punctuation followed by space/newline
  // Handles abbreviations (Mr., Dr., etc.) roughly
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z"“‘])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ── Core heuristics ─────────────────────────────────────────────────────────

/**
 * Run heuristic analysis on text. Fast, zero-cost, deterministic.
 * Used as fallback when LLM analysis fails, and for post-processing validation.
 */
export function heuristicAnalyze(text: string): HeuristicAnalysis {
  const sentences = splitSentences(text);
  const sentenceLengths = sentences.map((s) => s.split(/\s+/).length);

  const avgSentenceLength =
    sentenceLengths.length > 0
      ? sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length
      : 0;

  const sentenceLengthVariance =
    sentenceLengths.length > 1
      ? Math.sqrt(
          sentenceLengths.reduce(
            (sum, len) => sum + Math.pow(len - avgSentenceLength, 2),
            0,
          ) / sentenceLengths.length,
        )
      : 0;

  // Find repetitive phrases (3+ word phrases appearing 2+ times)
  const repetitivePhrases = findRepetitivePhrases(text);

  // Find filler phrases
  const fillerPhrases = findFillerPhrases(text);

  // Count passive voice constructions
  const passiveVoiceCount = countPassiveVoice(text);

  // Estimate readability (simplified Flesch-like)
  const readabilityScore = estimateReadability(
    text,
    sentences.length,
    sentenceLengths,
  );

  return {
    sentenceLengths,
    avgSentenceLength: Math.round(avgSentenceLength * 10) / 10,
    sentenceLengthVariance: Math.round(sentenceLengthVariance * 10) / 10,
    repetitivePhrases,
    fillerPhrases,
    passiveVoiceCount,
    readabilityScore,
  };
}

/**
 * Find phrases (3+ words) that appear more than once.
 */
function findRepetitivePhrases(
  text: string,
): { phrase: string; count: number }[] {
  const lower = text.toLowerCase();
  const phrases: Record<string, number> = {};

  // Extract 3-word and 4-word n-grams
  const words = lower.split(/\s+/);
  for (let n = 3; n <= 4; n++) {
    for (let i = 0; i <= words.length - n; i++) {
      const phrase = words.slice(i, i + n).join(" ");
      // Skip very common phrases
      if (isCommonPhrase(phrase)) continue;
      phrases[phrase] = (phrases[phrase] || 0) + 1;
    }
  }

  return Object.entries(phrases)
    .filter(([_, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([phrase, count]) => ({ phrase, count }));
}

function isCommonPhrase(phrase: string): boolean {
  const common = [
    "the the the",
    "of the the",
    "in the the",
    "to the the",
    "and the the",
    "is a the",
    "the and the",
    "of a the",
    "in a the",
    "and a the",
  ];
  return common.some((c) => phrase.startsWith(c));
}

/**
 * Find filler phrases from the known list.
 */
function findFillerPhrases(text: string): string[] {
  const lower = text.toLowerCase();
  return FILLER_PHRASES.filter((filler) => lower.includes(filler));
}

/**
 * Count passive voice constructions.
 * Pattern: form of "to be" + past participle (rough heuristic).
 */
function countPassiveVoice(text: string): number {
  const passivePatterns =
    /\b(is|are|was|were|be|been|being)\s+(being\s+)?\w+ed\b/gi;
  const matches = text.match(passivePatterns);
  return matches ? matches.length : 0;
}

/**
 * Estimate readability using a simplified Flesch-like formula.
 * Returns 0-100 (higher = easier to read).
 */
function estimateReadability(
  text: string,
  sentenceCount: number,
  sentenceLengths: number[],
): number {
  if (sentenceCount === 0 || !text.trim()) return 50;

  const words = text.split(/\s+/).length;
  const syllables = estimateSyllables(text);

  // Simplified Flesch Reading Ease
  const asl = words / sentenceCount; // average sentence length
  const asw = syllables / words; // average syllables per word
  const score = 206.835 - 1.015 * asl - 84.6 * asw;

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Rough syllable count (not perfect, but fast).
 */
function estimateSyllables(text: string): number {
  const words = text.toLowerCase().split(/\s+/);
  let total = 0;
  for (const word of words) {
    const clean = word.replace(/[^a-z]/g, "");
    if (clean.length === 0) continue;
    // Count vowel groups
    const vowelGroups = clean.match(/[aeiouy]+/g);
    let syllables = vowelGroups ? vowelGroups.length : 1;
    // Adjust for silent e
    if (clean.endsWith("e") && syllables > 1) syllables--;
    // Minimum 1
    total += Math.max(1, syllables);
  }
  return total;
}

// ── Post-processing validation ──────────────────────────────────────────────

/**
 * Detect quality issues in rewritten text.
 * Used after rewrite to validate output quality.
 */
export function detectQualityIssues(text: string): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const analysis = heuristicAnalyze(text);

  // Check for repetitive phrases
  for (const { phrase, count } of analysis.repetitivePhrases.slice(0, 3)) {
    if (count >= 3) {
      issues.push({
        type: "repetition",
        description: `Phrase "${phrase}" appears ${count} times`,
        severity: count >= 4 ? "high" : "medium",
      });
    }
  }

  // Check for filler phrases
  if (analysis.fillerPhrases.length > 0) {
    issues.push({
      type: "filler",
      description: `Contains ${analysis.fillerPhrases.length} filler phrase(s): ${analysis.fillerPhrases.slice(0, 3).join(", ")}`,
      severity: analysis.fillerPhrases.length >= 3 ? "high" : "medium",
    });
  }

  // Check for uniform rhythm (low sentence length variance)
  if (
    analysis.sentenceLengthVariance < 3 &&
    analysis.sentenceLengths.length > 3
  ) {
    issues.push({
      type: "uniform_rhythm",
      description: `Low sentence length variance (${analysis.sentenceLengthVariance}) — sentences are too similar in length`,
      severity: "medium",
    });
  }

  // Check for excessive passive voice
  const passiveRatio =
    analysis.sentenceLengths.length > 0
      ? analysis.passiveVoiceCount / analysis.sentenceLengths.length
      : 0;
  if (passiveRatio > 0.4) {
    issues.push({
      type: "passive_voice",
      description: `High passive voice ratio (${Math.round(passiveRatio * 100)}%)`,
      severity: passiveRatio > 0.6 ? "high" : "medium",
    });
  }

  // Check for transition crutch overuse
  const lower = text.toLowerCase();
  let crutchCount = 0;
  for (const crutch of TRANSITION_CRUTCHES) {
    const regex = new RegExp(`\\b${crutch}\\b`, "gi");
    const matches = lower.match(regex);
    if (matches) crutchCount += matches.length;
  }
  if (crutchCount >= 3) {
    issues.push({
      type: "weak_transitions",
      description: `Overuse of transition words (${crutchCount} instances)`,
      severity: crutchCount >= 5 ? "high" : "medium",
    });
  }

  return issues;
}

/**
 * Calculate a simple semantic similarity score between two texts.
 * Uses word overlap (Jaccard-like). Not as sophisticated as embeddings,
 * but fast and free.
 */
export function semanticSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\s+/));
  const words2 = new Set(text2.toLowerCase().split(/\s+/));

  // Remove stop words for better signal
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "to", "of", "in", "for",
    "on", "with", "at", "by", "from", "as", "into", "through", "during",
    "before", "after", "above", "below", "between", "under", "again",
    "and", "but", "or", "nor", "not", "so", "yet", "both", "either",
    "neither", "each", "every", "all", "any", "few", "more", "most",
    "other", "some", "such", "no", "only", "own", "same", "than",
    "too", "very", "just", "because", "if", "when", "while", "that",
    "this", "these", "those", "it", "its",
  ]);

  const contentWords1 = new Set([...words1].filter((w) => !stopWords.has(w)));
  const contentWords2 = new Set([...words2].filter((w) => !stopWords.has(w)));

  if (contentWords1.size === 0 && contentWords2.size === 0) return 100;
  if (contentWords1.size === 0 || contentWords2.size === 0) return 0;

  let intersection = 0;
  for (const word of contentWords1) {
    if (contentWords2.has(word)) intersection++;
  }

  const union = contentWords1.size + contentWords2.size - intersection;
  const jaccard = union > 0 ? intersection / union : 0;

  // Scale to 0-100, with a boost for high overlap
  return Math.min(100, Math.round(jaccard * 120));
}

/**
 * Check keyword naturalness — is the keyword used in good positions
 * without being stuffed?
 */
export function checkKeywordNaturalness(
  text: string,
  keyword: string,
): {
  score: number;
  placement: "natural" | "forced" | "absent";
  count: number;
} {
  if (!keyword) return { score: 0, placement: "absent", count: 0 };

  const lower = text.toLowerCase();
  const kw = keyword.toLowerCase();
  const words = lower.split(/\s+/);
  const totalWords = words.length;

  // Count occurrences
  let count = 0;
  let idx = 0;
  while ((idx = lower.indexOf(kw, idx)) !== -1) {
    count++;
    idx += kw.length;
  }

  if (count === 0) return { score: 30, placement: "absent", count: 0 };

  // Check density (keyword density should be 1-3%)
  const kwWordCount = keyword.split(/\s+/).length;
  const density = (count * kwWordCount) / totalWords;
  const densityScore =
    density >= 0.01 && density <= 0.03
      ? 100
      : density < 0.01
        ? 60
        : density <= 0.05
          ? 70
          : 30; // stuffed

  // Check if in first 10% (good placement)
  const firstTenPercent = text.slice(0, Math.ceil(text.length * 0.1)).toLowerCase();
  const inIntro = firstTenPercent.includes(kw);

  const placementScore = inIntro ? 100 : 70;

  const overallScore = Math.round(densityScore * 0.6 + placementScore * 0.4);
  const placement =
    count === 0 ? "absent" : density > 0.04 ? "forced" : "natural";

  return { score: overallScore, placement, count };
}

/**
 * Extract the dominant keywords from text (top N by frequency, excluding stop words).
 */
export function extractKeywords(
  text: string,
  maxKeywords: number = 10,
): { term: string; count: number }[] {
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "to", "of", "in", "for",
    "on", "with", "at", "by", "from", "as", "into", "through", "during",
    "and", "but", "or", "not", "so", "that", "this", "these", "those",
    "it", "its", "their", "they", "them", "he", "she", "we", "our",
    "which", "what", "where", "when", "how", "who", "whom",
    "also", "just", "about", "than", "then", "there", "here",
    "more", "most", "other", "some", "such", "very", "too",
  ]);

  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));

  const freq: Record<string, number> = {};
  for (const word of words) {
    freq[word] = (freq[word] || 0) + 1;
  }

  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxKeywords)
    .map(([term, count]) => ({ term, count }));
}
