/**
 * Canonical Document Model -> plain text. Used by the plain-text output adapter
 * and as a fallback for accessibility/summary features.
 */
import type { BlockNode, CanonicalDocument, InlineNode } from "../cdm";

function renderInline(nodes: InlineNode[]): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case "text":
          return n.text;
        case "citation":
          return n.text ?? `[${n.citationId}]`;
        case "math":
          return n.latex;
        case "hardBreak":
          return "\n";
        case "inlineUnknown":
          return String(n.raw ?? n.nodeType);
      }
    })
    .join("");
}

function cellContent(blocks: BlockNode[]): string {
  return blocks
    .map((b) => (b.type === "paragraph" ? renderInline(b.content) : renderBlocks([b])))
    .join(" ");
}

function renderBlocks(
  blocks: BlockNode[],
  placeholderLabels?: Record<string, string>,
): string {
  return blocks
    .map((node): string => {
      switch (node.type) {
        case "heading":
          return renderInline(node.content).toUpperCase();
        case "paragraph":
          return renderInline(node.content);
        case "bulletList":
          return node.items
            .map((i) => `• ${renderBlocks(i.content, placeholderLabels)}`)
            .join("\n");
        case "orderedList":
          return node.items
            .map((i, idx) => `${idx + 1}. ${renderBlocks(i.content, placeholderLabels)}`)
            .join("\n");
        case "blockquote":
          return renderBlocks(node.content)
            .split("\n")
            .map((l) => `> ${l}`)
            .join("\n");
        case "codeBlock":
          return node.text;
        case "horizontalRule":
          return "----------------------------------------";
        case "table":
          if (node.id && placeholderLabels?.[node.id]) {
            return placeholderLabels[node.id];
          }
          return node.rows
            .map((r) => r.cells.map((c) => cellContent(c.content)).join("\t"))
            .join("\n");
        case "figure":
          if (node.id && placeholderLabels?.[node.id]) {
            return placeholderLabels[node.id];
          }
          return node.src ? `[Figure: ${node.alt ?? node.src}]` : "[Figure]";
        case "equation":
          if (node.id && placeholderLabels?.[node.id]) {
            return placeholderLabels[node.id];
          }
          return node.latex;
        case "pageBreak":
          return "\n\n";
        case "appendix":
          return `${node.title ? node.title.toUpperCase() + "\n" : ""}${renderBlocks(node.content)}`;
        case "blockUnknown":
          return "";
      }
    })
    .join("\n\n");
}

export interface TextSerializeOptions {
  /** When a block node's `id` is present in this map, render it as the token. */
  placeholderLabels?: Record<string, string>;
}

export function cdmToPlainText(
  doc: CanonicalDocument,
  options: TextSerializeOptions = {},
): string {
  const body = renderBlocks(doc.body, options.placeholderLabels);
  const bibliography = doc.references.length
    ? `\n\nREFERENCES\n\n${doc.references.map((r) => r.raw ?? r.id).join("\n")}`
    : "";
  return `${doc.metadata.title ? doc.metadata.title.toUpperCase() + "\n\n" : ""}${body}${bibliography}`;
}
