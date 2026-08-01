"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.blockInlineNodes = blockInlineNodes;
exports.collectCitations = collectCitations;
exports.referenceIds = referenceIds;
exports.assetIdsDefined = assetIdsDefined;
exports.assetIdsUsed = assetIdsUsed;
exports.headingIndices = headingIndices;
/**
 * Helpers for walking a CanonicalDocument. The CDM is a typed tree, but a few
 * shapes (tables, figures) nest inline content differently, so these utils
 * centralise the traversal and keep the rules declarative.
 */
/** Inline nodes directly contained in a block (incl. nested table cells). */
function blockInlineNodes(block) {
    if (block.type === "table") {
        const out = [];
        for (const row of block.rows) {
            for (const cell of row.cells) {
                // Table cells contain BlockNodes (e.g. a paragraph), so recurse.
                for (const sub of cell.content ?? []) {
                    out.push(...blockInlineNodes(sub));
                }
            }
        }
        return out;
    }
    if ("content" in block && Array.isArray(block.content)) {
        return block.content;
    }
    return [];
}
function collectCitations(doc) {
    const out = [];
    doc.body.forEach((block, i) => {
        for (const inline of blockInlineNodes(block)) {
            if (inline.type === "citation") {
                out.push({
                    citationId: inline.citationId,
                    status: inline.status,
                    blockIndex: i,
                });
            }
        }
    });
    return out;
}
function referenceIds(doc) {
    return doc.references.map((r) => r.id);
}
function assetIdsDefined(doc) {
    return doc.assets.map((a) => a.id);
}
function assetIdsUsed(doc) {
    return doc.body
        .filter((b) => b.type === "figure")
        .map((f) => f.assetId)
        .filter((id) => typeof id === "string");
}
/** Heading block indices, in document order. */
function headingIndices(doc) {
    const out = [];
    doc.body.forEach((b, i) => {
        if (b.type === "heading")
            out.push(i);
    });
    return out;
}
