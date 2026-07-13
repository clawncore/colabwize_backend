"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.escapeHtml = escapeHtml;
exports.cdmToHtml = cdmToHtml;
const htmlCitation_1 = require("../citations/htmlCitation");
function escapeHtml(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
const PRINT_CSS = `
  body { font-family: Georgia, 'Times New Roman', serif; line-height: 1.5; max-width: 46em; margin: 2em auto; padding: 0 1em; color: #111; }
  h1,h2,h3,h4,h5,h6 { line-height: 1.2; }
  a.citation { color: inherit; text-decoration: none; }
  a.back-ref { color: inherit; text-decoration: none; font-size: 0.85em; margin-left: 0.3em; }
  a.doi-link, a.ext-link { color: #1d4ed8; text-decoration: underline; }
  .references { margin-top: 2em; }
  .reference-list { padding-left: 1.5em; }
  .reference-list li { margin-bottom: 0.4em; }
  figure { margin: 1.5em 0; text-align: center; }
  figure img { max-width: 100%; }
  figcaption { font-size: 0.9em; color: #444; margin-top: 0.5em; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #ccc; padding: 0.4em 0.6em; text-align: left; }
  pre { background: #f5f5f5; padding: 1em; overflow-x: auto; }
  code { font-family: 'Courier New', monospace; }
  blockquote { border-left: 3px solid #ccc; margin: 1em 0; padding-left: 1em; color: #444; }
  .page-break { page-break-after: always; }
  .equation { text-align: center; margin: 1em 0; font-style: italic; }
`;
function renderInline(nodes, ctx) {
    return nodes
        .map((n) => {
        switch (n.type) {
            case "text": {
                let text = escapeHtml(n.text);
                for (const mark of n.marks ?? []) {
                    switch (mark.type) {
                        case "bold":
                            text = `<strong>${text}</strong>`;
                            break;
                        case "italic":
                            text = `<em>${text}</em>`;
                            break;
                        case "underline":
                            text = `<u>${text}</u>`;
                            break;
                        case "strike":
                            text = `<del>${text}</del>`;
                            break;
                        case "code":
                            text = `<code>${text}</code>`;
                            break;
                        case "superscript":
                            text = `<sup>${text}</sup>`;
                            break;
                        case "subscript":
                            text = `<sub>${text}</sub>`;
                            break;
                        case "link":
                            text = `<a href="${escapeHtml(mark.href ?? "#")}">${text}</a>`;
                            break;
                        case "highlight":
                            text = `<mark>${text}</mark>`;
                            break;
                    }
                }
                return text;
            }
            case "citation":
                return (0, htmlCitation_1.renderInTextCitation)(n, ctx);
            case "math":
                return `<span class="math">${escapeHtml(n.latex)}</span>`;
            case "hardBreak":
                return "<br>";
            case "inlineUnknown":
                return escapeHtml(String(n.raw ?? n.nodeType));
        }
    })
        .join("");
}
function renderCellContent(blocks, ctx) {
    return blocks
        .map((b) => (b.type === "paragraph" ? renderInline(b.content, ctx) : renderBlocks([b], undefined, ctx)))
        .join(" ");
}
function renderBlocks(blocks, placeholderLabels, ctx) {
    const safeCtx = ctx ?? { seen: new Set(), refOrder: new Map() };
    return blocks
        .map((node) => {
        switch (node.type) {
            case "heading":
                return `<h${node.level}>${renderInline(node.content, safeCtx)}</h${node.level}>`;
            case "paragraph":
                return `<p>${renderInline(node.content, safeCtx)}</p>`;
            case "bulletList":
                return `<ul>${node.items
                    .map((i) => `<li>${renderBlocks(i.content, placeholderLabels, safeCtx)}</li>`)
                    .join("")}</ul>`;
            case "orderedList":
                return `<ol>${node.items
                    .map((i) => `<li>${renderBlocks(i.content, placeholderLabels, safeCtx)}</li>`)
                    .join("")}</ol>`;
            case "blockquote":
                return `<blockquote>${renderBlocks(node.content, placeholderLabels, safeCtx)}</blockquote>`;
            case "codeBlock":
                return `<pre><code>${escapeHtml(node.text)}</code></pre>`;
            case "horizontalRule":
                return "<hr>";
            case "table": {
                if (node.id && placeholderLabels?.[node.id]) {
                    return `<p class="placeholder">${escapeHtml(placeholderLabels[node.id])}</p>`;
                }
                const head = node.rows
                    .filter((r) => r.isHeader)
                    .map((r) => `<tr>${r.cells
                    .map((c) => `<th>${renderCellContent(c.content, safeCtx)}</th>`)
                    .join("")}</tr>`)
                    .join("");
                const body = node.rows
                    .filter((r) => !r.isHeader)
                    .map((r) => `<tr>${r.cells
                    .map((c) => `<td>${renderCellContent(c.content, safeCtx)}</td>`)
                    .join("")}</tr>`)
                    .join("");
                return `<table>${head ? `<thead>${head}</thead>` : ""}${body ? `<tbody>${body}</tbody>` : ""}</table>`;
            }
            case "figure": {
                if (node.id && placeholderLabels?.[node.id]) {
                    return `<p class="placeholder">${escapeHtml(placeholderLabels[node.id])}</p>`;
                }
                const img = node.src
                    ? `<img src="${escapeHtml(node.src)}" alt="${escapeHtml(node.alt ?? "")}"${typeof node.width === "number" ? ` width="${node.width}"` : ""}>`
                    : "";
                const caption = node.caption
                    ? `<figcaption>${renderBlocks(node.caption, placeholderLabels, safeCtx)}</figcaption>`
                    : "";
                return `<figure>${img}${caption}</figure>`;
            }
            case "equation":
                if (node.id && placeholderLabels?.[node.id]) {
                    return `<p class="placeholder">${escapeHtml(placeholderLabels[node.id])}</p>`;
                }
                return `<div class="equation">${escapeHtml(node.latex)}</div>`;
            case "pageBreak":
                return `<div class="page-break"></div>`;
            case "appendix":
                return `${node.title ? `<h2>${escapeHtml(node.title)}</h2>` : ""}${renderBlocks(node.content, placeholderLabels, safeCtx)}`;
            case "blockUnknown":
                return `<div data-unknown="${escapeHtml(node.nodeType)}"></div>`;
        }
    })
        .join("\n");
}
function renderBibliography(doc, seen) {
    return (0, htmlCitation_1.renderBibliographyEnriched)(doc, { seen });
}
function cdmToHtml(doc, options = {}) {
    // One shared context for the whole document so in-text citations and the
    // bibliography agree on "first occurrence" and display order.
    const seen = new Set();
    const refOrder = new Map(doc.references.map((r, i) => [r.id, i + 1]));
    const ctx = { seen, refOrder };
    const body = renderBlocks(doc.body, options.placeholderLabels, ctx);
    // We always self-render the bibliography (ColabWize owns citations; Pandoc
    // only converts). The legacy `citeproc` flag still suppresses the inline
    // bibliography for any caller that hands bibliography generation to Pandoc,
    // but the export pipeline no longer uses it.
    const bibliography = options.citeproc ? "" : renderBibliography(doc, seen);
    const inner = `${body}\n${bibliography}`;
    if (!options.fullDocument) {
        return inner;
    }
    const title = escapeHtml(doc.metadata.title ?? "Document");
    const authorMeta = doc.metadata.authors
        .map((a) => (a.affiliation ? `${a.name} (${a.affiliation})` : a.name))
        .join("; ");
    const metaTags = [
        authorMeta &&
            `<meta name="author" content="${escapeHtml(authorMeta)}">`,
        doc.metadata.keywords.length > 0 &&
            `<meta name="keywords" content="${escapeHtml(doc.metadata.keywords.join(", "))}">`,
        doc.metadata.abstract &&
            `<meta name="description" content="${escapeHtml(doc.metadata.abstract)}">`,
        `<meta name="citation-style" content="${escapeHtml(doc.settings.cslStyle)}">`,
    ]
        .filter(Boolean)
        .join("\n");
    return `<!DOCTYPE html>
<html lang="${escapeHtml(doc.settings.locale.split("-")[0] || "en")}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
${metaTags}
<style>${PRINT_CSS}</style>
</head>
<body>
${inner}
</body>
</html>`;
}
