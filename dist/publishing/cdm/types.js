"use strict";
/**
 * Canonical Document Model (CDM) — the single semantic intermediate representation
 * that every Publishing Platform output adapter consumes.
 *
 * Design notes:
 * - This model is semantic, NOT presentational. It deliberately avoids HTML so that
 *   citations, references, figures, equations and cross-references retain their meaning
 *   (the previous `prepareFinalHtml` regex approach lost this).
 * - No `any`. Unknown/unsupported source nodes are preserved via `*Unknown` variants and
 *   surfaced as `ValidationFinding`s so the UI can warn instead of silently dropping content.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultCanonicalSettings = defaultCanonicalSettings;
exports.defaultCanonicalMetadata = defaultCanonicalMetadata;
/* ------------------------------- Helpers -------------------------------- */
function defaultCanonicalSettings(overrides = {}) {
    return {
        locale: "en-US",
        direction: "ltr",
        cslStyle: "apa",
        pageGeometry: {
            size: "A4",
            margin: { top: "1in", bottom: "1in", left: "1in", right: "1in" },
            columns: 1,
        },
        numbering: { figures: true, tables: true, equations: true, headings: true },
        ...overrides,
    };
}
function defaultCanonicalMetadata(overrides = {}) {
    return {
        authors: [],
        keywords: [],
        ...overrides,
    };
}
