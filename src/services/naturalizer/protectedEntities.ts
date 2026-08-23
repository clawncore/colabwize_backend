/**
 * Preprocessing layer for the Academic Writing Naturalizer.
 *
 * Extracts protected entities (citations, references, numbers, units, URLs,
 * DOIs, technical terms) from raw input and replaces them with internal
 * placeholders so the rewriting model can't accidentally modify them.
 * Placeholders are restored verbatim after the rewrite.
 *
 * Design goals:
 *   - Never invent or drop a protected entity — hard integrity guarantee.
 *   - Placeholders are unambiguous tokens the LLM won't try to "improve".
 *   - Restoration is two-pass (token -> original) so the rewritten text
 *     matches the original's entity set exactly.
 */

export interface ProtectedEntity {
  placeholder: string;   // e.g. "[CITATION_001]"
  original: string;      // exact substring from the input
  type:
    | "citation"
    | "reference"
    | "number"
    | "unit"
    | "url"
    | "doi"
    | "equation"
    | "gene"
    | "protein"
    | "chemical"
    | "species"
    | "technical_term";
}

export interface PreprocessedText {
  /** Text with placeholders in place of protected entities. */
  masked: string;
  /** Map from placeholder back to original substring. */
  entities: ProtectedEntity[];
  /** Total count by type, surfaced in the response for transparency. */
  counts: Record<ProtectedEntity["type"], number>;
}

// ── Regex library ────────────────────────────────────────────────────────────

// APA/MLA/Chicago: (Smith et al., 2020) | (Smith, 2020) | (Smith and Jones, 2020)
const RE_CITATION_AUTHOR_YEAR =
  /\(([A-Z][a-zA-ZÀ-ſ'’.\-]+(?:\s+et\s+al\.?)?(?:\s*,?\s*(?:and|&)\s+[A-Z][a-zA-ZÀ-ſ'’.\-]+)?)?,?\s*\d{4}[a-z]?\)/g;

// IEEE / Vancouver: [1] [2,3] [1-4]
const RE_CITATION_NUMERIC = /\[\s*\d+(?:\s*[-,]\s*\d+)*\s*\]/g;

// Footnote: ¹²³ etc.
const RE_FOOTNOTE = /[¹²³⁴⁵⁶⁷⁸⁹⁰]+/g;

// Numeric: 1, 1.5, 0.05, 85%, 2.5-fold, n = 120, p < 0.05, e.g., 3.42 × 10^8
const RE_NUMBER =
  /(?<![A-Za-z])(?:p\s*[<>=]\s*|n\s*=\s*)?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?:\s*%|\s*°\s*[CFK]|\s*×\s*10\^\-?\d+|\s*-\s*fold|\s*(?:mg|g|kg|ml|µl|μl|ul|mL|mmol|mol|µmol|μmol|M|mM|µM|μM|nM|pM|U| IU|kDa|Da|kb|mb|gb|h|min|s|ms|Hz|kHz|MHz|GHz|nm|µm|μm|mm|cm|m|km|yr|years?|months?|days?|weeks?|hours?))?/g;

// URL / DOI
const RE_URL = /https?:\/\/[^\s)\]}>,"']+/g;
const RE_DOI = /\b10\.\d{4,9}\/[-._;()\/:A-Z0-9]+/gi;

// Equations: simple paren or LaTeX-style inline
const RE_EQUATION_INLINE = /\$[^$]{1,200}\$/g;

// Quoted blocks
const RE_QUOTE_DOUBLE = /"[^"]{8,300}"/g;
const RE_QUOTE_SINGLE = /'[^']{8,300}'/g;

// Headings / numbered lists (preserve structure)
const RE_HEADING = /^(#{1,6})\s+.*$/gm;
const RE_LIST_ITEM = /^(\s*)([-*+]|\d+\.)\s+/gm;

const PROTECTED_ORDER: Array<{ type: ProtectedEntity["type"]; re: RegExp }> = [
  { type: "url", re: RE_URL },
  { type: "doi", re: RE_DOI },
  { type: "equation", re: RE_EQUATION_INLINE },
  { type: "citation", re: RE_CITATION_NUMERIC },
  { type: "citation", re: RE_CITATION_AUTHOR_YEAR },
  { type: "number", re: RE_NUMBER },
];

// Splits text into alternating plain / already-placeholder segments.
const PLACEHOLDER_SPLIT = /(\[[A-Z_]+_\d+\])/g;
const IS_PLACEHOLDER = /^\[[A-Z_]+_\d+\]$/;

/**
 * Run one masking pass over `text`, but ONLY on segments that aren't
 * already placeholders. Without this, later passes (e.g. numbers) match
 * the digits inside earlier placeholders (`[CITATION_001]`) and corrupt
 * them into nested tokens.
 */
function maskPass(
  text: string,
  type: ProtectedEntity["type"],
  re: RegExp,
  entities: ProtectedEntity[],
  counters: Record<ProtectedEntity["type"], number>,
): string {
  const parts = text.split(PLACEHOLDER_SPLIT);
  for (let i = 0; i < parts.length; i++) {
    const chunk = parts[i];
    if (!chunk || IS_PLACEHOLDER.test(chunk)) continue;
    re.lastIndex = 0;
    parts[i] = chunk.replace(re, (match) => {
      counters[type] += 1;
      const id = `${type.toUpperCase()}_${String(counters[type]).padStart(3, "0")}`;
      entities.push({ placeholder: `[${id}]`, original: match, type });
      return `[${id}]`;
    });
  }
  return parts.join("");
}

/**
 * Replace protected entities with stable placeholders. Order matters: we
 * walk the regex list once per type, and each pass only touches text
 * outside existing placeholders so passes can't nest or corrupt each other.
 */
export function preprocess(input: string): PreprocessedText {
  const entities: ProtectedEntity[] = [];
  const counters: Record<ProtectedEntity["type"], number> = {
    citation: 0, reference: 0, number: 0, unit: 0, url: 0,
    doi: 0, equation: 0, gene: 0, protein: 0, chemical: 0,
    species: 0, technical_term: 0,
  };

  let masked = input;

  for (const { type, re } of PROTECTED_ORDER) {
    masked = maskPass(masked, type, re, entities, counters);
  }

  // Footnote markers get classified as references.
  masked = maskPass(masked, "reference", RE_FOOTNOTE, entities, counters);

  return { masked, entities, counts: counters };
}

/**
 * Inverse of preprocess — replace every placeholder in `text` with its
 * original entity. Unmatched placeholders pass through (defensive: lets the
 * LLM see "missing" rather than silently swallowing text).
 */
export function restore(text: string, entities: ProtectedEntity[]): string {
  let out = text;
  for (const e of entities) {
    if (out.includes(e.placeholder)) {
      out = out.split(e.placeholder).join(e.original);
    }
  }
  return out;
}

/**
 * Integrity check: every placeholder that survives a rewrite must still
 * appear in the result. Missing placeholders indicate the LLM dropped a
 * protected entity, which means the rewrite must be rejected.
 */
export function validateIntegrity(
  result: string,
  entities: ProtectedEntity[],
): { ok: boolean; missing: ProtectedEntity[] } {
  const missing = entities.filter((e) => !result.includes(e.placeholder));
  return { ok: missing.length === 0, missing };
}
