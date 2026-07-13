"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeCsl = exports.BUILTIN_CSL_STYLES = void 0;
exports.listCslStyles = listCslStyles;
exports.getCslStyleFile = getCslStyleFile;
exports.normalizeReference = normalizeReference;
const cslNormalization_1 = require("../../utils/cslNormalization");
/**
 * CSL style registry — the "migrate CSL engine in" step of Phase 4.
 *
 * The existing `cslNormalization.ts` already knows how to normalise reference
 * data for Pandoc citeproc. Here we centralise the *available styles* (the CSL
 * files shipped under `src/assets/csl`) so templates and the export pipeline
 * share one source of truth, instead of the legacy code passing a free-form
 * `citationStyle` string that `PandocExportService` ignored (gap T5).
 */
exports.BUILTIN_CSL_STYLES = ["apa", "mla", "chicago", "ieee"];
const STYLE_FILES = {
    apa: "apa.csl",
    mla: "mla.csl",
    chicago: "chicago.csl",
    ieee: "ieee.csl",
};
const STYLE_LABELS = {
    apa: "APA (American Psychological Association)",
    mla: "MLA (Modern Language Association)",
    chicago: "Chicago",
    ieee: "IEEE",
};
function listCslStyles() {
    return exports.BUILTIN_CSL_STYLES.map((id) => ({
        id,
        label: STYLE_LABELS[id] ?? id.toUpperCase(),
        file: STYLE_FILES[id],
    }));
}
function getCslStyleFile(name) {
    return STYLE_FILES[name];
}
/** Re-export the existing normaliser so the whole platform uses one impl. */
function normalizeReference(input) {
    return (0, cslNormalization_1.normalizeToCSL)(input);
}
exports.normalizeCsl = cslNormalization_1.normalizeToCSL;
