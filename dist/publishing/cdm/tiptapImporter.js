"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tiptapToCdm = tiptapToCdm;
/**
 * TipTap JSON -> Canonical Document Model importer.
 *
 * This is the single, authoritative converter from editor content into the CDM.
 * It replaces the previous `prepareFinalHtml` regex approach: instead of munging
 * serialized HTML, we walk the semantic node tree and preserve meaning
 * (citations, references, figures, equations, tables).
 *
 * Unsupported/unknown nodes are never silently dropped — they are preserved as
 * `*Unknown` variants and recorded in `annotations` so the Validation Engine and
 * UI can warn the user.
 */
const types_1 = require("./types");
const tiptap_1 = require("./tiptap");
const IMAGE_NODE_TYPES = new Set([
    "image",
    "imageExtension",
    "figureImage",
    "advancedImage",
    "resizableImage",
]);
const CAPTION_NODE_TYPES = new Set(["figcaption", "caption"]);
const TABLE_HEADER_TYPES = new Set(["tableHeader"]);
function str(value) {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
function num(value) {
    return typeof value === "number" && !Number.isNaN(value) ? value : undefined;
}
function asText(nodes) {
    if (!nodes)
        return "";
    return nodes
        .map((n) => {
        if (typeof n.text === "string")
            return n.text;
        if (n.content)
            return asText(n.content);
        return "";
    })
        .join("");
}
/** Map a TipTap mark to a CDM inline mark. Unknown marks are ignored. */
function convertMark(mark) {
    switch (mark.type) {
        case "bold":
        case "italic":
        case "underline":
        case "strike":
        case "code":
        case "superscript":
        case "subscript":
            return { type: mark.type };
        case "link":
            return { type: "link", href: str(mark.attrs?.href) };
        case "highlight":
            return { type: "highlight", color: str(mark.attrs?.color) };
        default:
            return null;
    }
}
function convertInline(nodes) {
    const out = [];
    if (!nodes)
        return out;
    for (const node of nodes) {
        if (node.type === "text") {
            const marks = (node.marks ?? [])
                .map(convertMark)
                .filter((m) => m !== null);
            out.push({
                type: "text",
                text: node.text ?? "",
                ...(marks.length ? { marks } : {}),
            });
            continue;
        }
        if (node.type === "citation") {
            const citation = {
                type: "citation",
                citationId: str(node.attrs?.citationId) ?? "",
                ...(str(node.attrs?.text) ? { text: str(node.attrs?.text) } : {}),
                ...(str(node.attrs?.url) ? { url: str(node.attrs?.url) } : {}),
                ...(str(node.attrs?.status) ? { status: str(node.attrs?.status) } : {}),
            };
            out.push(citation);
            continue;
        }
        if (node.type === "math") {
            const math = {
                type: "math",
                latex: str(node.attrs?.latex) ?? "",
                ...(node.attrs?.block === true ? { block: true } : {}),
            };
            out.push(math);
            continue;
        }
        if (node.type === "hardBreak") {
            out.push({ type: "hardBreak" });
            continue;
        }
        out.push({ type: "inlineUnknown", nodeType: node.type, raw: node });
    }
    return out;
}
function convertListItem(node) {
    const blocks = (node.content ?? []).map(convertBlock).filter((b) => b !== null);
    return { type: "listItem", content: blocks };
}
function findImage(nodes) {
    for (const n of nodes) {
        if (IMAGE_NODE_TYPES.has(n.type))
            return n;
        if (n.content) {
            const found = findImage(n.content);
            if (found)
                return found;
        }
    }
    return undefined;
}
function findCaption(nodes) {
    for (const n of nodes) {
        if (CAPTION_NODE_TYPES.has(n.type)) {
            const inner = convertInline(n.content);
            return [{ type: "paragraph", content: inner }];
        }
    }
    return undefined;
}
function convertFigure(node, assets, findings) {
    const inner = node.content ?? [];
    const image = findImage(inner);
    const caption = findCaption(inner);
    const figure = { type: "figure" };
    if (image) {
        const src = str(image.attrs?.src);
        if (src) {
            const assetId = `asset-${assets.length + 1}`;
            assets.push({
                id: assetId,
                ...(str(image.attrs?.alt) ? { caption: str(image.attrs?.alt) } : {}),
                ...(num(image.attrs?.width) ? { width: num(image.attrs?.width) } : {}),
            });
            figure.src = src;
            figure.assetId = assetId;
            figure.alt = str(image.attrs?.alt);
            figure.title = str(image.attrs?.title);
            figure.width = image.attrs?.width;
        }
    }
    else {
        findings.push({
            severity: "warning",
            code: "figure_without_image",
            message: "Figure node contained no recognized image child.",
            locator: { nodeType: "figure" },
        });
    }
    if (caption)
        figure.caption = caption;
    if (str(node.attrs?.span))
        figure.span = str(node.attrs?.span);
    if (str(node.attrs?.style))
        figure.style = str(node.attrs?.style);
    return figure;
}
/**
 * Convert a standalone image node (the common case: the editor's `setImage`
 * command inserts a bare `image` block via AdvancedImageExtension, not a
 * `figure` wrapper). Without this, a bare `image` hit the `default` branch and
 * became a `blockUnknown` node — which the HTML/serializers render as an empty
 * `<div>`, silently dropping the picture. Treat it as a figure so the `src`
 * survives into the exported artifact.
 */
function convertImageToFigure(node, assets, findings) {
    const src = str(node.attrs?.src);
    const figure = { type: "figure" };
    if (src) {
        const assetId = `asset-${assets.length + 1}`;
        assets.push({
            id: assetId,
            ...(str(node.attrs?.alt) ? { caption: str(node.attrs?.alt) } : {}),
            ...(num(node.attrs?.width) ? { width: num(node.attrs?.width) } : {}),
        });
        figure.src = src;
        figure.assetId = assetId;
        figure.alt = str(node.attrs?.alt);
        figure.title = str(node.attrs?.title);
        figure.width = node.attrs?.width;
    }
    else {
        findings.push({
            severity: "warning",
            code: "image_without_src",
            message: "Image node contained no `src` attribute and was dropped.",
            locator: { nodeType: node.type },
        });
    }
    if (str(node.attrs?.caption)) {
        figure.caption = [
            { type: "paragraph", content: [{ type: "text", text: str(node.attrs?.caption) }] },
        ];
    }
    return figure;
}
function convertTable(node) {
    const rows = [];
    for (const row of node.content ?? []) {
        if (row.type !== "tableRow")
            continue;
        const cells = [];
        let allHeader = row.content?.length ? true : false;
        for (const cell of row.content ?? []) {
            const isHeader = TABLE_HEADER_TYPES.has(cell.type);
            if (!isHeader)
                allHeader = false;
            cells.push({
                type: "tableCell",
                content: (cell.content ?? [])
                    .map(convertBlock)
                    .filter((b) => b !== null),
                ...(num(cell.attrs?.colspan) ? { colspan: num(cell.attrs?.colspan) } : {}),
                ...(num(cell.attrs?.rowspan) ? { rowspan: num(cell.attrs?.rowspan) } : {}),
                isHeader,
            });
        }
        rows.push({ type: "tableRow", cells, isHeader: allHeader });
    }
    return { type: "table", rows };
}
/**
 * Convert a single TipTap block node to a CDM BlockNode (or null if it should be
 * lifted out of the body — e.g. bibliography entries become References).
 */
function convertBlock(node) {
    switch (node.type) {
        case "heading":
            return {
                type: "heading",
                level: num(node.attrs?.level) ?? 1,
                content: convertInline(node.content),
                ...(str(node.attrs?.id) ? { id: str(node.attrs?.id) } : {}),
            };
        case "paragraph":
            return { type: "paragraph", content: convertInline(node.content) };
        case "bulletList":
            return {
                type: "bulletList",
                items: (node.content ?? []).map(convertListItem),
            };
        case "orderedList":
            return {
                type: "orderedList",
                items: (node.content ?? []).map(convertListItem),
                ...(num(node.attrs?.start) ? { start: num(node.attrs?.start) } : {}),
            };
        case "blockquote":
            return {
                type: "blockquote",
                content: (node.content ?? [])
                    .map(convertBlock)
                    .filter((b) => b !== null),
            };
        case "codeBlock":
            return {
                type: "codeBlock",
                text: asText(node.content),
                ...(str(node.attrs?.language)
                    ? { language: str(node.attrs?.language) }
                    : {}),
            };
        case "horizontalRule":
            return { type: "horizontalRule" };
        case "table":
            return convertTable(node);
        case "figure":
            // handled by caller (needs assets/findings); but safe to convert directly too
            return convertFigure(node, [], []);
        case "image":
        case "imageExtension":
        case "figureImage":
        case "advancedImage":
        case "resizableImage":
            return convertImageToFigure(node, [], []);
        case "math":
            return { type: "equation", latex: str(node.attrs?.latex) ?? "" };
        case "pageBreak":
        case "pagebreak":
            return { type: "pageBreak" };
        case "bibliographyEntry":
            // Lifted out into `references` by the top-level walker.
            return null;
        default:
            return { type: "blockUnknown", nodeType: node.type, raw: node };
    }
}
function tiptapToCdm(input, options = {}) {
    if (!(0, tiptap_1.isTiptapDoc)(input)) {
        throw new Error("tiptapToCdm: input is not a TipTap document (type !== 'doc').");
    }
    const findings = [];
    const references = [];
    const assets = [];
    const body = [];
    for (const node of input.content) {
        if (node.type === "bibliographyEntry") {
            const id = str(node.attrs?.citationId) ?? "";
            references.push({
                id,
                raw: asText(node.content) || str(node.attrs?.refText) || undefined,
                ...(str(node.attrs?.url) ? { url: str(node.attrs?.url) } : {}),
                ...(str(node.attrs?.doi) ? { doi: str(node.attrs?.doi) } : {}),
                ...(str(node.attrs?.refText) ? { refText: str(node.attrs?.refText) } : {}),
            });
            continue;
        }
        if (node.type === "figure") {
            body.push(convertFigure(node, assets, findings));
            continue;
        }
        if (IMAGE_NODE_TYPES.has(node.type)) {
            body.push(convertImageToFigure(node, assets, findings));
            continue;
        }
        const converted = convertBlock(node);
        if (converted) {
            body.push(converted);
            if (converted.type === "blockUnknown") {
                findings.push({
                    severity: "warning",
                    code: "unsupported_block_node",
                    message: `Unsupported block node "${converted.nodeType}" was preserved but may not render in all formats.`,
                    locator: { nodeType: converted.nodeType, blockIndex: body.length - 1 },
                });
            }
        }
    }
    // Flag unresolved citations for the validation layer.
    const walkInline = (nodes, blockIndex) => {
        for (const n of nodes) {
            if (n.type === "citation" && n.status && n.status !== "resolved") {
                findings.push({
                    severity: "warning",
                    code: "unresolved_citation",
                    message: `Citation "${n.citationId}" is not resolved.`,
                    locator: { citationId: n.citationId, blockIndex },
                });
            }
        }
    };
    body.forEach((b, i) => {
        if (b.type === "heading" || b.type === "paragraph")
            walkInline(b.content, i);
        if (b.type === "blockquote")
            b.content.forEach((c) => {
                if (c.type === "heading" || c.type === "paragraph")
                    walkInline(c.content, i);
            });
    });
    const metadata = {
        ...(0, types_1.defaultCanonicalMetadata)(),
        ...(options.metadata ?? {}),
    };
    const settings = {
        ...(0, types_1.defaultCanonicalSettings)(),
        ...(options.settings ?? {}),
    };
    return {
        schemaVersion: "1.0",
        metadata,
        settings,
        body,
        references,
        assets,
        annotations: findings,
    };
}
