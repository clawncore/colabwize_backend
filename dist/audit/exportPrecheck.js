"use strict";
/**
 * Export Pre-Check — one consolidated citation-audit pass for export.
 *
 * This is the "one go" the user asked for: it runs the structural ValidationEngine
 * rules AND the citation-audit style/pattern checks together over a single
 * CanonicalDocument, and returns one unified `PrecheckReport`. The export job
 * calls this once (background, during export) so issues are flagged *before* the
 * artifact is produced.
 *
 * It is deliberately the *pre-flight* gate:
 *   - structural integrity  (ValidationEngine: dangling/orphan/unresolved citations…)
 *   - citation *style* compliance (CitationPatternObserver + STYLE_RULES)
 *   - a required reference-section check + numbering check derived from STYLE_RULES
 * It does NOT include the expensive network/URL verification or the semantic-claim
 * LLM checks from `runUnifiedAudit` — those remain available via
 * `/api/citations/audit/unified`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.runExportPrecheck = runExportPrecheck;
const engine_1 = require("../publishing/validation/engine");
const CitationPatternObserver_1 = require("../services/citationAudit/CitationPatternObserver");
const styleRules_1 = require("../services/citationAudit/styleRules");
const text_1 = require("../publishing/serializers/text");
// ───────────────────────────── helpers ─────────────────────────────
function textOf(nodes) {
    if (!nodes)
        return "";
    return nodes
        .map((n) => ("text" in n && typeof n.text === "string" ? n.text : ""))
        .join("")
        .trim();
}
function normalizeValidation(f) {
    return {
        code: f.code,
        source: "validation",
        severity: f.severity,
        message: f.message,
        locator: f.locator
            ? {
                citationId: f.locator.citationId,
                blockIndex: f.locator.blockIndex,
                kind: f.locator.nodeType,
            }
            : undefined,
    };
}
function normalizeStyleFlag(flag) {
    // Any disallowed pattern or mixed style is blocking for a publication export:
    // a journal will desk-reject inconsistent or wrong-format citations.
    return {
        code: `style-${flag.detectedPattern}`,
        source: "citation-style",
        severity: "error",
        message: flag.message,
        locator: { kind: "citation" },
    };
}
/**
 * Detect a missing required reference section (e.g. "References" for APA) by
 * scanning document headings (case-insensitive, trimmed).
 */
function missingReferenceSection(doc, style) {
    const required = (0, styleRules_1.getStyleRules)(style).referenceList.requiredSectionTitle;
    if (!required || required.length === 0)
        return null;
    const headings = doc.body
        .filter((b) => b.type === "heading")
        .map((h) => textOf(h.content).toLowerCase());
    const anyMatch = required.some((title) => headings.some((h) => h.includes(title.toLowerCase())));
    if (anyMatch)
        return null;
    return {
        code: "missing-reference-section",
        source: "citation-style",
        severity: "error",
        message: `No "${required[0]}" section found. ${style} requires a reference list section titled "${required[0]}".`,
        locator: { kind: "section" },
    };
}
/**
 * If the style disallows numbered reference entries but numeric [n] citations are
 * present in prose, flag it (e.g. APA/MLA/Chicago(author-date) require
 * author-year, not [1]).
 */
function numberingMismatch(doc, style) {
    const rules = (0, styleRules_1.getStyleRules)(style);
    if (rules.referenceList.numberingAllowed)
        return null;
    const prose = (0, text_1.cdmToPlainText)(doc);
    const numeric = prose.match(/\[\s*\d+(?:[\s,–-]+\d+)*\s*\]/g);
    if (!numeric)
        return null;
    return {
        code: "style-numbering",
        source: "citation-style",
        severity: "error",
        message: `Numbered citation${numeric.length === 1 ? "" : "s"} [n] detected, but ${style} requires non-numbered format.`,
        locator: { kind: "citation" },
    };
}
// ───────────────────────────── public API ─────────────────────────────
/**
 * Run the consolidated export pre-check over a single CDM. Pure and synchronous
 * (no network), so it is safe to run inside the job processor on every export.
 */
function runExportPrecheck(doc, opts = {}) {
    const style = (opts.style ?? "APA");
    const engine = opts.engine ?? (0, engine_1.createValidationEngine)();
    const findings = [];
    // 1. Structural integrity pass.
    const structural = engine.validate(doc);
    findings.push(...structural.findings.map(normalizeValidation));
    // 2. Citation-style pass (operates on plain text — no ProseMirror dependency).
    const prose = (0, text_1.cdmToPlainText)(doc);
    const styleFlags = CitationPatternObserver_1.CitationPatternObserver.observe(prose, style);
    findings.push(...styleFlags.map(normalizeStyleFlag));
    findings.push(...CitationPatternObserver_1.CitationPatternObserver.detectMixedStyles(prose).map(normalizeStyleFlag));
    const sectionFinding = missingReferenceSection(doc, style);
    if (sectionFinding)
        findings.push(sectionFinding);
    const numberingFinding = numberingMismatch(doc, style);
    if (numberingFinding)
        findings.push(numberingFinding);
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
        style,
    };
}
