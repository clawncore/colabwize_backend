"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assignStableIds = assignStableIds;
function yearOf(doc) {
    const raw = doc.metadata.date;
    if (raw) {
        const y = new Date(raw).getFullYear();
        if (!Number.isNaN(y))
            return y;
    }
    return new Date().getFullYear();
}
function mint(prefix, year, n) {
    return `${prefix}-${year}-${String(n).padStart(4, "0")}`;
}
/**
 * Return a deep clone of `doc` with stable `id` stamped onto every
 * figure/table/equation/codeBlock that lacks one. Deterministic per document:
 * the sequence is assigned in document order. Existing ids are preserved.
 */
function assignStableIds(doc) {
    const next = structuredClone(doc);
    const year = yearOf(next);
    const counters = { FIG: 0, TAB: 0, EQ: 0, ALG: 0 };
    const ids = { figures: [], tables: [], equations: [], algorithms: [] };
    const visit = (node) => {
        switch (node.type) {
            case "figure":
                if (!node.id) {
                    counters.FIG += 1;
                    node.id = mint("FIG", year, counters.FIG);
                }
                ids.figures.push(node.id);
                break;
            case "table":
                if (!node.id) {
                    counters.TAB += 1;
                    node.id = mint("TAB", year, counters.TAB);
                }
                ids.tables.push(node.id);
                break;
            case "equation":
                if (!node.id) {
                    counters.EQ += 1;
                    node.id = mint("EQ", year, counters.EQ);
                }
                ids.equations.push(node.id);
                break;
            case "codeBlock":
                if (!node.id) {
                    counters.ALG += 1;
                    node.id = mint("ALG", year, counters.ALG);
                }
                ids.algorithms.push(node.id);
                break;
            default:
                break;
        }
        // Recurse into container nodes so figures/tables inside lists/quotes/appendices
        // are also indexed.
        switch (node.type) {
            case "bulletList":
            case "orderedList":
                for (const item of node.items)
                    for (const b of item.content)
                        visit(b);
                break;
            case "blockquote":
            case "appendix":
                for (const b of node.content)
                    visit(b);
                break;
            case "table":
                for (const row of node.rows)
                    for (const cell of row.cells)
                        for (const b of cell.content)
                            visit(b);
                break;
            default:
                break;
        }
    };
    for (const b of next.body)
        visit(b);
    return { doc: next, ids };
}
