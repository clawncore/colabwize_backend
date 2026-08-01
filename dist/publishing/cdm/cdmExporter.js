"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cdmToTiptap = cdmToTiptap;
function exportMark(mark) {
    switch (mark.type) {
        case "link":
            return { type: "link", attrs: { href: mark.href ?? "" } };
        case "highlight":
            return { type: "highlight", attrs: { color: mark.color } };
        default:
            return { type: mark.type };
    }
}
function exportInline(nodes) {
    return nodes.map((n) => {
        switch (n.type) {
            case "text":
                return {
                    type: "text",
                    text: n.text,
                    ...(n.marks?.length ? { marks: n.marks.map(exportMark) } : {}),
                };
            case "citation": {
                const c = n;
                return {
                    type: "citation",
                    attrs: {
                        citationId: c.citationId,
                        ...(c.text ? { text: c.text } : {}),
                        ...(c.url ? { url: c.url } : {}),
                        ...(c.status ? { status: c.status } : {}),
                    },
                };
            }
            case "math": {
                const m = n;
                return {
                    type: "math",
                    attrs: { latex: m.latex, ...(m.block ? { block: true } : {}) },
                };
            }
            case "hardBreak":
                return { type: "hardBreak" };
            default:
                return { type: "inlineUnknown" };
        }
    });
}
function exportBlock(node) {
    switch (node.type) {
        case "heading": {
            const h = node;
            return {
                type: "heading",
                attrs: { level: h.level, ...(h.id ? { id: h.id } : {}) },
                content: exportInline(h.content),
            };
        }
        case "paragraph": {
            const p = node;
            return { type: "paragraph", content: exportInline(p.content) };
        }
        case "bulletList":
            return {
                type: "bulletList",
                content: node.items.map((i) => ({
                    type: "listItem",
                    content: i.content.map(exportBlock).flat(),
                })),
            };
        case "orderedList":
            return {
                type: "orderedList",
                attrs: node.start ? { start: node.start } : {},
                content: node.items.map((i) => ({
                    type: "listItem",
                    content: i.content.map(exportBlock).flat(),
                })),
            };
        case "blockquote":
            return {
                type: "blockquote",
                content: node.content.map(exportBlock).flat(),
            };
        case "codeBlock":
            return {
                type: "codeBlock",
                attrs: node.language ? { language: node.language } : {},
                content: [{ type: "text", text: node.text }],
            };
        case "horizontalRule":
            return { type: "horizontalRule" };
        case "table": {
            const t = node;
            return {
                type: "table",
                content: t.rows.map(exportRow),
            };
        }
        case "figure":
            return exportFigure(node);
        case "equation":
            return {
                type: "paragraph",
                content: [
                    { type: "math", attrs: { latex: node.latex, block: true } },
                ],
            };
        case "pageBreak":
            return { type: "pageBreak" };
        case "appendix":
            return {
                type: "blockquote",
                content: [
                    ...(node.title
                        ? [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: node.title }] }]
                        : []),
                    ...node.content.map(exportBlock).flat(),
                ],
            };
        case "blockUnknown":
            // Passthrough if the original was a TipTap node; otherwise degrade to text.
            return isTiptapShape(node.raw)
                ? node.raw
                : { type: "paragraph", content: [{ type: "text", text: `[${node.nodeType}]` }] };
        default:
            return { type: "paragraph", content: [] };
    }
}
function exportRow(row) {
    return {
        type: "tableRow",
        content: row.cells.map(exportCell),
    };
}
function exportCell(cell) {
    return {
        type: cell.isHeader ? "tableHeader" : "tableCell",
        attrs: {
            ...(cell.colspan ? { colspan: cell.colspan } : {}),
            ...(cell.rowspan ? { rowspan: cell.rowspan } : {}),
        },
        content: cell.content.map(exportBlock).flat(),
    };
}
function exportFigure(figure) {
    const content = [];
    if (figure.src) {
        content.push({
            type: "imageExtension",
            attrs: {
                src: figure.src,
                ...(figure.alt ? { alt: figure.alt } : {}),
                ...(figure.title ? { title: figure.title } : {}),
                ...(figure.width !== undefined ? { width: figure.width } : {}),
            },
        });
    }
    if (figure.caption && figure.caption.length) {
        content.push({
            type: "figcaption",
            content: figure.caption.map(exportBlock).flat(),
        });
    }
    return {
        type: "figure",
        attrs: {
            ...(figure.span ? { span: figure.span } : {}),
            ...(figure.style ? { style: figure.style } : {}),
        },
        content,
    };
}
function exportReference(ref) {
    return {
        type: "bibliographyEntry",
        attrs: {
            citationId: ref.id,
            ...(ref.url ? { url: ref.url } : {}),
            ...(ref.doi ? { doi: ref.doi } : {}),
            ...(ref.refText ? { refText: ref.refText } : {}),
        },
        content: [{ type: "text", text: ref.raw ?? ref.id }],
    };
}
function isTiptapShape(value) {
    return (typeof value === "object" &&
        value !== null &&
        typeof value.type === "string");
}
function cdmToTiptap(doc) {
    const bodyNodes = doc.body.map(exportBlock).flat();
    const referenceNodes = doc.references.map(exportReference);
    return {
        type: "doc",
        content: [...bodyNodes, ...referenceNodes],
    };
}
