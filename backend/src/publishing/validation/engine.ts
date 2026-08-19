import type { CanonicalDocument } from "../cdm";
import type { ValidationReport, ValidationRule } from "./types";
import { DEFAULT_VALIDATION_RULES } from "./rules";

/**
 * ValidationEngine — runs a set of rules over a CanonicalDocument and produces
 * an aggregated `ValidationReport`. Rules are injected so callers can add or
 * remove checks (e.g. a journal template could add stricter rules).
 */
export class ValidationEngine {
  constructor(private readonly rules: ValidationRule[] = DEFAULT_VALIDATION_RULES) {}

  validate(doc: CanonicalDocument): ValidationReport {
    const findings = this.rules.flatMap((rule) => rule.validate(doc));

    const errors = findings.filter((f) => f.severity === "error");
    const warnings = findings.filter((f) => f.severity === "warning");
    const infos = findings.filter((f) => f.severity === "info");

    return {
      findings,
      errors,
      warnings,
      infos,
      errorCount: errors.length,
      warningCount: warnings.length,
      infoCount: infos.length,
      ok: errors.length === 0,
    };
  }
}

export function createValidationEngine(
  rules: ValidationRule[] = DEFAULT_VALIDATION_RULES,
): ValidationEngine {
  return new ValidationEngine(rules);
}
