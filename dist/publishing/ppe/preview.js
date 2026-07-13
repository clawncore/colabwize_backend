"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildExportPreviewHtml = buildExportPreviewHtml;
exports.buildExportPreviewPieces = buildExportPreviewPieces;
const html_1 = require("../serializers/html");
const ids_1 = require("./ids");
const xref_1 = require("./xref");
const profiles_1 = require("./profiles");
function buildExportPreviewHtml(input) {
    const { doc, mode, ppe, cslStyle } = input;
    const profile = mode === "publication" ? (0, profiles_1.getPublisherProfile)(ppe?.profileId) : undefined;
    const figurePlacement = profile && ppe?.placement?.figures
        ? ppe.placement.figures
        : profile?.figurePlacement ?? "inline";
    const tablePlacement = profile && ppe?.placement?.tables
        ? ppe.placement.tables
        : profile?.tablePlacement ?? "inline";
    // Stable ids + cross-reference index so placeholder tokens match the export.
    const { doc: augmented } = (0, ids_1.assignStableIds)(doc);
    const { index } = (0, xref_1.buildCrossReferenceIndex)(augmented);
    const placeholderLabels = {};
    if (profile) {
        if (figurePlacement !== "inline") {
            for (const e of index.figures)
                placeholderLabels[e.internalId] = profile.placeholderStyle("figure", e.displayNumber);
        }
        if (tablePlacement !== "inline") {
            for (const e of index.tables)
                placeholderLabels[e.internalId] = profile.placeholderStyle("table", e.displayNumber);
        }
    }
    // Citations are always self-rendered by the serializer (ColabWize owns
    // citations; Pandoc only converts), and the preview must match the export
    // exactly — so we never use citeproc here.
    return (0, html_1.cdmToHtml)(augmented, {
        fullDocument: false,
        placeholderLabels,
        citeproc: false,
    });
}
/**
 * Render every piece the export will actually emit, so the UI can show a
 * pre-export preview of each separated file (manuscript / figures / tables)
 * using the *same* serializer the export uses. This is the "proof before you
 * commit" view: pick "separate", and you can inspect exactly what each file
 * will contain before the job runs.
 */
function buildExportPreviewPieces(input) {
    const { doc, mode, ppe, cslStyle } = input;
    const profile = mode === "publication" ? (0, profiles_1.getPublisherProfile)(ppe?.profileId) : undefined;
    const figurePlacement = profile && ppe?.placement?.figures
        ? ppe.placement.figures
        : profile?.figurePlacement ?? "inline";
    const tablePlacement = profile && ppe?.placement?.tables
        ? ppe.placement.tables
        : profile?.tablePlacement ?? "inline";
    const { doc: augmented } = (0, ids_1.assignStableIds)(doc);
    const { index } = (0, xref_1.buildCrossReferenceIndex)(augmented);
    const pieces = {
        manuscriptHtml: buildExportPreviewHtml({ doc, mode, ppe, cslStyle }),
    };
    // Separate Figures document (mirrors buildSubmissionPackage's Figures.html).
    if (figurePlacement !== "inline" && index.figures.length > 0) {
        const figBlocks = [];
        for (const e of index.figures) {
            const fig = findFigure(augmented, e.internalId);
            if (fig)
                figBlocks.push(fig);
            figBlocks.push(heading(e.displayNumber));
            if (e.caption)
                figBlocks.push(para(`Caption: ${e.caption}`));
            figBlocks.push(horizontalRule());
        }
        pieces.figuresHtml = (0, html_1.cdmToHtml)(subDoc(augmented, figBlocks), {
            fullDocument: false,
        });
    }
    // Separate Tables document (mirrors buildSubmissionPackage's Tables.html).
    if (tablePlacement !== "inline" && index.tables.length > 0) {
        const tabBlocks = [];
        for (const e of index.tables) {
            const tbl = findTable(augmented, e.internalId);
            if (tbl)
                tabBlocks.push(heading(e.displayNumber), tbl, horizontalRule());
        }
        pieces.tablesHtml = (0, html_1.cdmToHtml)(subDoc(augmented, tabBlocks), {
            fullDocument: false,
        });
    }
    return pieces;
}
/* --- small CDM helpers (kept local to avoid churning package.ts) --- */
function para(text) {
    return { type: "paragraph", content: [{ type: "text", text }] };
}
function heading(text) {
    return { type: "heading", level: 2, content: [{ type: "text", text }] };
}
function horizontalRule() {
    return { type: "horizontalRule" };
}
function subDoc(doc, body) {
    return {
        schemaVersion: "1.0",
        metadata: doc.metadata,
        settings: doc.settings,
        body,
        references: [],
        assets: [],
    };
}
function findFigure(doc, id) {
    let found;
    const visit = (blocks) => {
        for (const b of blocks) {
            if (found)
                return;
            if (b.type === "figure" && b.id === id) {
                found = b;
                return;
            }
            if (b.type === "bulletList" || b.type === "orderedList")
                for (const it of b.items)
                    visit(it.content);
            if (b.type === "blockquote" || b.type === "appendix")
                visit(b.content);
            if (b.type === "table")
                for (const row of b.rows)
                    for (const cell of row.cells)
                        visit(cell.content);
        }
    };
    visit(doc.body);
    return found;
}
function findTable(doc, id) {
    let found;
    const visit = (blocks) => {
        for (const b of blocks) {
            if (found)
                return;
            if (b.type === "table" && b.id === id) {
                found = b;
                return;
            }
            if (b.type === "bulletList" || b.type === "orderedList")
                for (const it of b.items)
                    visit(it.content);
            if (b.type === "blockquote" || b.type === "appendix")
                visit(b.content);
            if (b.type === "table")
                for (const row of b.rows)
                    for (const cell of row.cells)
                        visit(cell.content);
        }
    };
    visit(doc.body);
    return found;
}
