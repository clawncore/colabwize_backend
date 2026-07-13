"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultPlaceholderFormatter = void 0;
exports.buildPlaceholderLabels = buildPlaceholderLabels;
function buildPlaceholderLabels(index, fmt) {
    const map = {};
    for (const e of index.figures)
        map[e.internalId] = fmt("figure", e.displayNumber);
    for (const e of index.tables)
        map[e.internalId] = fmt("table", e.displayNumber);
    for (const e of index.equations)
        map[e.internalId] = fmt("equation", e.displayNumber);
    return map;
}
/**
 * Default placeholder style: `Figure 1 here` / `Table 2 here`. A plain,
 * human-readable callout that survives as text in the manuscript when a
 * figure/table is separated into its own file.
 */
const defaultPlaceholderFormatter = (_kind, displayNumber) => `${displayNumber} here`;
exports.defaultPlaceholderFormatter = defaultPlaceholderFormatter;
