"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ValidationEngine = void 0;
exports.createValidationEngine = createValidationEngine;
const rules_1 = require("./rules");
/**
 * ValidationEngine — runs a set of rules over a CanonicalDocument and produces
 * an aggregated `ValidationReport`. Rules are injected so callers can add or
 * remove checks (e.g. a journal template could add stricter rules).
 */
class ValidationEngine {
    rules;
    constructor(rules = rules_1.DEFAULT_VALIDATION_RULES) {
        this.rules = rules;
    }
    validate(doc) {
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
exports.ValidationEngine = ValidationEngine;
function createValidationEngine(rules = rules_1.DEFAULT_VALIDATION_RULES) {
    return new ValidationEngine(rules);
}
