"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cdmToMarkdown = cdmToMarkdown;
function renderInline(nodes) {
    return nodes
        .map((n) => {
        switch (n.type) {
            case "text": {
                let text = n.text;
                for (const mark of n.marks ?? []) {
                    switch (mark.type) {
                        case "bold":
                            text = `**${text}**`;
                            break;
                        case "italic":
                            text = `*${text}*`;
                            break;
                        case "underline":
                            text = `<u>${text}</u>`;
                            break;
                        case "strike":
                            text = `~~${text}~~`;
                            break;
                        case "code":
                            text = "`" + text + "`";
                            break;
                        case "link":
                            text = `[${text}](${mark.href ?? "#"})`;
                            break;
                        case "highlight":
                            text = `==${text}==`;
                            break;
                        default:
                            break;
                    }
                }
                return text;
            }
            case "citation":
                return n.text ?? `[${n.citationId}]`;
            case "math":
                return `$${n.latex}$`;
            case "hardBreak":
                return "  \n";
            case "inlineUnknown":
                return String(n.raw ?? n.nodeType);
        }
    })
        .join("");
}
function cellContent(blocks) {
    return blocks
        .map((b) => (b.type === "paragraph" ? renderInline(b.content) : renderBlocks([b])))
        .join(" ");
}
function renderBlocks(blocks, depth = 0, placeholderLabels) {
    return blocks
        .map((node) => {
        switch (node.type) {
            case "heading":
                return `${"#".repeat(node.level)} ${renderInline(node.content)}`;
            case "paragraph":
                return renderInline(node.content);
            case "bulletList":
                return node.items
                    .map((i) => `- ${renderBlocks(i.content, depth + 1, placeholderLabels)}`)
                    .join("\n");
            case "orderedList":
                return node.items
                    .map((i, idx) => `${idx + 1}. ${renderBlocks(i.content, depth + 1, placeholderLabels)}`)
                    .join("\n");
            case "blockquote":
                return renderBlocks(node.content)
                    .split("\n")
                    .map((l) => `> ${l}`)
                    .join("\n");
            case "codeBlock":
                return "```" + (node.language ?? "") + "\n" + node.text + "\n```";
            case "horizontalRule":
                return "---";
            case "table": {
                if (node.id && placeholderLabels?.[node.id]) {
                    return placeholderLabels[node.id];
                }
                const header = node.rows.find((r) => r.isHeader);
                const rows = node.rows.filter((r) => !r.isHeader);
                if (!header)
                    return "";
                const head = `| ${header.cells.map((c) => cellContent(c.content)).join(" | ")} |`;
                const sep = `| ${header.cells.map(() => "---").join(" | ")} |`;
                const body = rows
                    .map((r) => `| ${r.cells.map((c) => cellContent(c.content)).join(" | ")} |`)
                    .join("\n");
                return `${head}\n${sep}\n${body}`;
            }
            case "figure":
                if (node.id && placeholderLabels?.[node.id]) {
                    return placeholderLabels[node.id];
                }
                return `${node.src ? `![${node.alt ?? ""}](${node.src})` : ""}${node.caption ? `\n*${renderBlocks(node.caption)}*` : ""}`;
            case "equation":
                if (node.id && placeholderLabels?.[node.id]) {
                    return placeholderLabels[node.id];
                }
                return `$$${node.latex}$$`;
            case "pageBreak":
                return ""; // no markdown equivalent
            case "appendix":
                return `${node.title ? `## ${node.title}` : ""}\n${renderBlocks(node.content)}`;
            case "blockUnknown":
                return ""; // dropped in markdown
        }
    })
        .join("\n\n");
}
function cdmToMarkdown(doc, options = {}) {
    const body = renderBlocks(doc.body, 0, options.placeholderLabels);
    const bibliography = doc.references.length
        ? `## References\n\n${doc.references
            .map((r) => `- ${r.raw ?? r.id}`)
            .join("\n")}`
        : "";
    return [body, bibliography].filter(Boolean).join("\n\n");
}
