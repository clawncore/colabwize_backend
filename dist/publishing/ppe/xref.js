"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCrossReferenceIndex = buildCrossReferenceIndex;
const text_1 = require("../serializers/text");
function captionText(caption, doc) {
    if (!caption || caption.length === 0)
        return "";
    const text = (0, text_1.cdmToPlainText)({ ...doc, body: caption, references: [], assets: [] });
    return text.replace(/\s+/g, " ").trim();
}
function collectCitations(nodes, acc) {
    for (const n of nodes) {
        if (n.type === "citation") {
            acc.push(n.citationId);
        }
        else if (n.type === "text" || n.type === "math") {
            // no nested inline
        }
    }
}
function collectBlockCitations(blocks, acc) {
    for (const b of blocks) {
        switch (b.type) {
            case "paragraph":
            case "heading":
                collectCitations(b.content, acc);
                break;
            case "bulletList":
            case "orderedList":
                for (const item of b.items)
                    collectBlockCitations(item.content, acc);
                break;
            case "blockquote":
            case "appendix":
                collectBlockCitations(b.content, acc);
                break;
            case "table":
                for (const row of b.rows)
                    for (const cell of row.cells)
                        collectBlockCitations(cell.content, acc);
                break;
            case "figure":
                if (b.caption)
                    collectBlockCitations(b.caption, acc);
                break;
            default:
                break;
        }
    }
}
function buildEntries(doc) {
    const figures = [];
    const tables = [];
    const equations = [];
    const walk = (blocks, depth) => {
        blocks.forEach((b, idx) => {
            const blockIndex = depth === 0 ? idx : -1;
            switch (b.type) {
                case "figure":
                    figures.push({
                        internalId: b.id ?? `FIG-unknown-${figures.length}`,
                        displayNumber: `Figure ${figures.length + 1}`,
                        displayLabel: `Figure ${figures.length + 1}`,
                        blockIndex,
                        referenced: false,
                        caption: captionText(b.caption, doc),
                    });
                    break;
                case "table":
                    tables.push({
                        internalId: b.id ?? `TAB-unknown-${tables.length}`,
                        displayNumber: `Table ${tables.length + 1}`,
                        displayLabel: `Table ${tables.length + 1}`,
                        blockIndex,
                        referenced: false,
                    });
                    break;
                case "equation":
                    equations.push({
                        internalId: b.id ?? `EQ-unknown-${equations.length}`,
                        displayNumber: `Equation ${equations.length + 1}`,
                        displayLabel: `Equation ${equations.length + 1}`,
                        blockIndex,
                        referenced: false,
                    });
                    break;
                default:
                    break;
            }
            switch (b.type) {
                case "bulletList":
                case "orderedList":
                    for (const item of b.items)
                        walk(item.content, depth + 1);
                    break;
                case "blockquote":
                case "appendix":
                    walk(b.content, depth + 1);
                    break;
                case "table":
                    for (const row of b.rows)
                        for (const cell of row.cells)
                            walk(cell.content, depth + 1);
                    break;
                case "figure":
                    if (b.caption)
                        walk(b.caption, depth + 1);
                    break;
                default:
                    break;
            }
        });
    };
    walk(doc.body, 0);
    return { figures, tables, equations };
}
function markReferenced(prose, entries, label, numberGroup, findings, codeMissing, kind) {
    const matches = prose.matchAll(label);
    for (const m of matches) {
        const n = Number(m[numberGroup]);
        const entry = entries[n - 1];
        if (entry) {
            entry.referenced = true;
        }
        else {
            findings.push({
                severity: "warning",
                code: codeMissing,
                message: `Text references ${kind} ${n} but no such ${kind.toLowerCase()} exists in the document.`,
                locator: { kind: kind.toLowerCase() },
            });
        }
    }
}
function checkReferences(refs, citedIds, findings) {
    const seen = new Map();
    for (const r of refs)
        seen.set(r.id, (seen.get(r.id) ?? 0) + 1);
    return refs.map((r) => {
        const count = seen.get(r.id) ?? 1;
        const duplicate = count > 1;
        const cited = citedIds.has(r.id);
        const missingDoi = !r.doi && !(r.cslJson && (r.cslJson.DOI || r.cslJson.doi));
        const csl = r.cslJson;
        const missingYear = !!csl && csl.year === undefined && csl.issued === undefined;
        if (duplicate) {
            findings.push({
                severity: "error",
                code: "DUPLICATE_REFERENCE",
                message: `Duplicate reference id "${r.id}" (${count} occurrences).`,
                locator: { kind: "reference", id: r.id },
            });
        }
        if (!cited) {
            findings.push({
                severity: "info",
                code: "REFERENCE_UNCITED",
                message: `Reference "${r.id}" is never cited in the text.`,
                locator: { kind: "reference", id: r.id },
            });
        }
        if (missingDoi) {
            findings.push({
                severity: "warning",
                code: "MISSING_DOI",
                message: `Reference "${r.id}" is missing a DOI/URL.`,
                locator: { kind: "reference", id: r.id },
            });
        }
        if (missingYear) {
            findings.push({
                severity: "warning",
                code: "MISSING_YEAR",
                message: `Reference "${r.id}" is missing a publication year.`,
                locator: { kind: "reference", id: r.id },
            });
        }
        return { id: r.id, cited, missingDoi, missingYear, duplicate };
    });
}
function buildCrossReferenceIndex(doc) {
    const findings = [];
    const { figures, tables, equations } = buildEntries(doc);
    const prose = (0, text_1.cdmToPlainText)(doc);
    markReferenced(prose, figures, /Figure\s+(\d+)|Fig\.\s*(\d+)/gi, 1, findings, "FIGURE_REF_MISSING", "Figure");
    markReferenced(prose, tables, /Table\s+(\d+)/gi, 1, findings, "TABLE_REF_MISSING", "Table");
    markReferenced(prose, equations, /Equation\s+(\d+)/gi, 1, findings, "EQUATION_REF_MISSING", "Equation");
    for (const e of [...figures, ...tables, ...equations]) {
        if (!e.referenced) {
            findings.push({
                severity: "warning",
                code: "OBJECT_UNREFERENCED",
                message: `${e.displayLabel} is never referenced in the text.`,
                locator: { kind: e.displayLabel.split(" ")[0].toLowerCase(), id: e.internalId, blockIndex: e.blockIndex },
            });
        }
    }
    // Citations
    const citationIds = [];
    collectBlockCitations(doc.body, citationIds);
    const uniqueCitations = Array.from(new Set(citationIds));
    const refIds = new Set(doc.references.map((r) => r.id));
    const citations = uniqueCitations.map((citationId) => {
        const resolved = refIds.has(citationId);
        if (!resolved) {
            findings.push({
                severity: "error",
                code: "BROKEN_CITATION",
                message: `Citation "${citationId}" has no matching reference entry.`,
                locator: { kind: "citation", id: citationId },
            });
        }
        return { citationId, resolved, referenced: true };
    });
    const citedSet = new Set(citationIds);
    const references = checkReferences(doc.references, citedSet, findings);
    return {
        index: { figures, tables, equations, citations, references },
        findings,
    };
}
