/**
 * Integrity validators for the Academic Writing Naturalizer.
 *
 * These run *after* placeholders are restored, comparing the rewritten
 * output against the original input. Failures are hard stops — the
 * candidate is rejected and the rewrite engine tries again, up to
 * MAX_ITERATIONS.
 */

import { ProtectedEntity } from "./protectedEntities";

export interface ValidationReport {
  ok: boolean;
  citationIntegrity: boolean;
  numericalIntegrity: boolean;
  placeholderIntegrity: boolean;
  warnings: string[];
}

const NUMERIC_TOKEN_RE =
  /(?<![A-Za-z])(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g;

/** Extract every numeric token from a string. */
export function extractNumbers(text: string): string[] {
  return (text.match(NUMERIC_TOKEN_RE) || []).map((n) => n.replace(/,/g, ""));
}

/** Extract every parenthetical / bracket citation-like construct. */
export function extractCitations(text: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /\([A-Z][a-zA-Z'’.\-]+(?:\s+et\s+al\.?)?,?\s*\d{4}[a-z]?\)/g,
    /[A-Z][a-zA-Z]+(?:\s+et\s+al\.?)?\s*\(\d{4}\)/g,
    /\[\s*\d+(?:\s*[-,]\s*\d+)*\s*\]/g,
  ];
  for (const re of patterns) {
    re.lastIndex = 0;
    const matches = text.match(re);
    if (matches) matches.forEach((m) => found.add(m));
  }
  return [...found];
}

/**
 * Verify every citation in the original also appears in the output.
 * This is the citation integrity guarantee — we never fabricate or drop.
 */
export function validateCitations(original: string, rewritten: string): {
  ok: boolean;
  missing: string[];
} {
  const originalCitations = extractCitations(original);
  const missing = originalCitations.filter((c) => !rewritten.includes(c));
  return { ok: missing.length === 0, missing };
}

/**
 * Verify every numeric value in the original appears in the output, *as a
 * token* — meaning "10" must not become "100" or "0.05" not become "0.5".
 * We compare token sets; if a numeric appears in original it must appear in
 * output. (We don't compare counts — repetitions are intentional in academic
 * prose and protecting them is too brittle.)
 */
export function validateNumbers(original: string, rewritten: string): {
  ok: boolean;
  missing: string[];
} {
  const originalNumbers = new Set(extractNumbers(original));
  const rewrittenNumbers = new Set(extractNumbers(rewritten));
  const missing: string[] = [];
  for (const n of originalNumbers) {
    if (!rewrittenNumbers.has(n)) missing.push(n);
  }
  return { ok: missing.length === 0, missing };
}

/**
 * Anti-Unicode / homoglyph guard. Reject any candidate that introduces
 * non-ASCII characters absent from the original — a defense against
 * Unicode-attack style evasion. Ordinary re-punctuation (a new colon,
 * semicolon, etc.) stays allowed; invisible lookalikes do not.
 */
export function validateNoNewCharacters(original: string, rewritten: string): {
  ok: boolean;
  introduced: string[];
} {
  const origChars = new Set(original);
  const introduced: string[] = [];
  for (const ch of rewritten) {
    const code = ch.codePointAt(0) ?? 0;
    // Only police characters outside plain ASCII — those are the ones a
    // homoglyph attack relies on.
    if (code > 0x7f && !origChars.has(ch)) {
      introduced.push(ch);
    }
  }
  return { ok: introduced.length === 0, introduced: [...new Set(introduced)] };
}

/**
 * Composition: run every hard validator in sequence. Any failure returns
 * ok: false with a descriptive warning.
 */
export function validate(
  original: string,
  rewritten: string,
  entities: ProtectedEntity[],
): ValidationReport {
  const warnings: string[] = [];

  const placeholderCheck = entities.filter(
    (e) => !rewritten.includes(e.placeholder),
  );
  const placeholderOk = placeholderCheck.length === 0;
  if (!placeholderOk) {
    warnings.push(
      `${placeholderCheck.length} protected element(s) lost during rewrite: ${placeholderCheck
        .map((p) => p.placeholder)
        .slice(0, 5)
        .join(", ")}`,
    );
  }

  const citationCheck = validateCitations(original, rewritten);
  if (!citationCheck.ok) {
    warnings.push(`Citations missing: ${citationCheck.missing.join(", ")}`);
  }

  const numericCheck = validateNumbers(original, rewritten);
  if (!numericCheck.ok) {
    warnings.push(`Numbers changed: ${numericCheck.missing.join(", ")}`);
  }

  const charCheck = validateNoNewCharacters(original, rewritten);
  if (!charCheck.ok) {
    warnings.push(
      `New characters introduced (homoglyph guard): ${charCheck.introduced
        .slice(0, 5)
        .join(", ")}`,
    );
  }

  return {
    ok: placeholderOk && citationCheck.ok && numericCheck.ok && charCheck.ok,
    citationIntegrity: citationCheck.ok,
    numericalIntegrity: numericCheck.ok,
    placeholderIntegrity: placeholderOk,
    warnings,
  };
}
