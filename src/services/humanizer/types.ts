/**
 * Shared types for the Humanizer writing transformation pipeline.
 *
 * Pipeline flow: Text Analysis → Rewrite Engine → Quality Scoring
 * Each stage has clearly defined input/output types.
 */

// ── Pipeline Options ─────────────────────────────────────────────────────────

export type HumanizeMode =
  | "humanize"
  | "humanize_seo"
  | "seo_optimize"
  | "improve_writing";

export type WritingStyle =
  | "natural"
  | "professional"
  | "academic"
  | "conversational"
  | "technical"
  | "simple";

export type SEOOptimizationLevel = "off" | "balanced" | "strong";

export interface RewriteOptions {
  mode: HumanizeMode;
  style: WritingStyle;
  seoOptimize: SEOOptimizationLevel;
  preserveStructure: boolean;
  preserveKeywords: boolean;
  preserveTerminology: boolean;
}

export const DEFAULT_OPTIONS: RewriteOptions = {
  mode: "humanize",
  style: "natural",
  seoOptimize: "off",
  preserveStructure: true,
  preserveKeywords: true,
  preserveTerminology: true,
};

// ── Stage 1: Text Analysis ──────────────────────────────────────────────────

export interface Entity {
  name: string;
  type: string; // "person" | "organization" | "location" | "date" | "concept" | "citation"
}

export interface Claim {
  claim: string;
  importance: "high" | "medium" | "low";
  numbers: string[];
  dates: string[];
  sourceSentence: string;
}

export interface Keyword {
  term: string;
  frequency: number;
  placement: string[]; // where it appears: "title" | "intro" | "body" | "conclusion"
}

export interface StyleProfile {
  formality: number;        // 0-100 (0=very informal, 100=very formal)
  sentenceVariation: number; // 0-100 (0=uniform length, 100=highly varied)
  vocabularyComplexity: number; // 0-100
  directness: number;       // 0-100 (0=very hedged, 100=very direct)
  technicality: number;     // 0-100
}

export interface QualityIssue {
  type: "repetition" | "filler" | "passive_voice" | "uniform_rhythm" | "awkward_phrasing" | "excessive_hedging" | "weak_transitions";
  description: string;
  severity: "high" | "medium" | "low";
  location?: string; // approximate location in text
}

export interface SEOSignals {
  searchIntent: string;     // "informational" | "commercial" | "transactional" | "how-to" | "problem-solving"
  primaryTopic: string;
  relatedConcepts: string[];
  topicGaps: string[];
  entityCoverage: number;   // 0-100
}

export interface TextAnalysis {
  topic: string;
  intent: string;
  language: string;
  sentenceCount: number;
  paragraphCount: number;
  entities: Entity[];
  claims: Claim[];
  keywords: Keyword[];
  styleProfile: StyleProfile;
  qualityIssues: QualityIssue[];
  seo: SEOSignals;
}

// ── Stage 2: Rewrite Result ─────────────────────────────────────────────────

export interface QualityScores {
  semanticPreservation: number;  // 0-100
  factualConsistency: number;    // 0-100
  readability: number;           // 0-100
  naturalness: number;           // 0-100
  structure: number;             // 0-100
  topicalCoverage: number;       // 0-100
  overallQuality: number;        // 0-100 (weighted composite)
}

export interface SEOInsights {
  primaryKeyword: string;
  keywordPlacement: "natural" | "forced" | "absent";
  topicCoverage: number;        // 0-100
  intentAlignment: string;
  improvements: string[];
}

export interface RewriteMetadata {
  originalWordCount: number;
  rewrittenWordCount: number;
  analysisMs: number;
  rewriteMs: number;
  totalMs: number;
}

export interface RewriteResult {
  rewritten: string;
  scores: QualityScores;
  improvements: string[];
  seo: SEOInsights | null;
  metadata: RewriteMetadata;
}

// ── SSE Events ──────────────────────────────────────────────────────────────

export type PipelineStage = "analyzing" | "rewriting" | "scoring" | "complete" | "error";

export interface ProgressEvent {
  type: "progress";
  stage: PipelineStage;
  label: string;
  warning?: string;
}

export interface TokenEvent {
  type: "token";
  text: string;
}

export interface CompleteEvent {
  type: "complete";
  result: RewriteResult;
}

export interface ErrorEvent {
  type: "error";
  message: string;
  stage: PipelineStage;
}

export type PipelineEvent = ProgressEvent | TokenEvent | CompleteEvent | ErrorEvent;

// ── API Request/Response ────────────────────────────────────────────────────

export interface HumanizeRequest {
  text: string;
  mode?: HumanizeMode;
  style?: WritingStyle;
  seoOptimize?: SEOOptimizationLevel;
  preserveStructure?: boolean;
  preserveKeywords?: boolean;
  preserveTerminology?: boolean;
}

// ── Fallback / Heuristic Types ──────────────────────────────────────────────

export interface HeuristicAnalysis {
  sentenceLengths: number[];
  avgSentenceLength: number;
  sentenceLengthVariance: number;
  repetitivePhrases: { phrase: string; count: number }[];
  fillerPhrases: string[];
  passiveVoiceCount: number;
  readabilityScore: number; // 0-100 (higher = easier to read)
}
