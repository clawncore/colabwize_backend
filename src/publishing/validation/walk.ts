import type {
  BlockNode,
  CanonicalDocument,
  InlineNode,
} from "../cdm";

/**
 * Helpers for walking a CanonicalDocument. The CDM is a typed tree, but a few
 * shapes (tables, figures) nest inline content differently, so these utils
 * centralise the traversal and keep the rules declarative.
 */

/** Inline nodes directly contained in a block (incl. nested table cells). */
export function blockInlineNodes(block: BlockNode): InlineNode[] {
  if (block.type === "table") {
    const out: InlineNode[] = [];
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
  if ("content" in block && Array.isArray((block as { content?: unknown }).content)) {
    return (block as { content: InlineNode[] }).content;
  }
  return [];
}

export interface CollectedCitation {
  citationId?: string;
  status?: string;
  blockIndex: number;
}

export function collectCitations(doc: CanonicalDocument): CollectedCitation[] {
  const out: CollectedCitation[] = [];
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

export function referenceIds(doc: CanonicalDocument): string[] {
  return doc.references.map((r) => r.id);
}

export function assetIdsDefined(doc: CanonicalDocument): string[] {
  return doc.assets.map((a) => a.id);
}

export function assetIdsUsed(doc: CanonicalDocument): string[] {
  return doc.body
    .filter((b): b is Extract<BlockNode, { type: "figure" }> => b.type === "figure")
    .map((f) => f.assetId)
    .filter((id): id is string => typeof id === "string");
}

/** Heading block indices, in document order. */
export function headingIndices(doc: CanonicalDocument): number[] {
  const out: number[] = [];
  doc.body.forEach((b, i) => {
    if (b.type === "heading") out.push(i);
  });
  return out;
}
