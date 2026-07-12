import type { CanonicalDocument, ValidationFinding } from "../cdm";

/**
 * Phase 4 — Validation Engine.
 *
 * A `ValidationRule` inspects a CanonicalDocument and returns the
 * `ValidationFinding`s it discovers. Findings are surfaced to the UI so the
 * user can fix issues before publishing, instead of silently dropping or
 * mangling content (the old `prepareFinalHtml` behaviour).
 *
 * Severity contract:
 *   - "error"   → blocks publish (e.g. a citation that points at nothing).
 *   - "warning" → non-blocking (e.g. an uncited reference).
 *   - "info"    → advisory.
 * A document is `ok` when it has zero errors (warnings are allowed).
 */
export interface ValidationRule {
  /** Stable machine code, e.g. "dangling-citation". */
  code: string;
  /** Human description of what this rule checks. */
  description: string;
  validate(doc: CanonicalDocument): ValidationFinding[];
}

export interface ValidationReport {
  findings: ValidationFinding[];
  errors: ValidationFinding[];
  warnings: ValidationFinding[];
  infos: ValidationFinding[];
  errorCount: number;
  warningCount: number;
  infoCount: number;
  /** true when there are no errors. */
  ok: boolean;
}
