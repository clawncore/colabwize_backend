/**
 * Export preview builder.
 *
 * Renders the manuscript HTML with the *same* serializer and options the real
 * export uses, so the in-app preview is WYSIWYG with the generated artifact:
 *  - standard export  -> cdmToHtml with the document's citation style,
 *  - publication export -> citeproc on + figure/table placeholder tokens that
 *    match the separated Submission package (Manuscript.docx shows placeholders,
 *    Figures/Tables/Images are emitted as separate files).
 *
 * This intentionally mirrors `buildSubmissionPackage`'s manuscript step rather
 * than the editor's own TipTap-HTML rendering, which previously diverged (most
 * visibly in the references section).
 */
import type { BlockNode, CanonicalDocument, CslStyle } from "../cdm";
import { cdmToHtml } from "../serializers/html";
import { assignStableIds } from "./ids";
import { buildCrossReferenceIndex } from "./xref";
import { getPublisherProfile } from "./profiles";
import type { PpeSettings } from "./types";

export interface ExportPreviewInput {
  doc: CanonicalDocument;
  mode: "standard" | "publication";
  ppe?: PpeSettings;
  cslStyle?: CslStyle;
}

export function buildExportPreviewHtml(input: ExportPreviewInput): string {
  const { doc, mode, ppe, cslStyle } = input;
  const profile =
    mode === "publication" ? getPublisherProfile(ppe?.profileId) : undefined;

  const figurePlacement =
    profile && ppe?.placement?.figures
      ? ppe.placement.figures
      : profile?.figurePlacement ?? "inline";
  const tablePlacement =
    profile && ppe?.placement?.tables
      ? ppe.placement.tables
      : profile?.tablePlacement ?? "inline";

  // Stable ids + cross-reference index so placeholder tokens match the export.
  const { doc: augmented } = assignStableIds(doc);
  const { index } = buildCrossReferenceIndex(augmented);

  const placeholderLabels: Record<string, string> = {};
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
  return cdmToHtml(augmented, {
    fullDocument: false,
    placeholderLabels,
    citeproc: false,
  });
}

export interface ExportPreviewPieces {
  /** Manuscript (with placeholder callouts when figures/tables are separated). */
  manuscriptHtml: string;
  /** Separate Figures document HTML (present only when figures are non-inline). */
  figuresHtml?: string;
  /** Separate Tables document HTML (present only when tables are non-inline). */
  tablesHtml?: string;
}

/**
 * Render every piece the export will actually emit, so the UI can show a
 * pre-export preview of each separated file (manuscript / figures / tables)
 * using the *same* serializer the export uses. This is the "proof before you
 * commit" view: pick "separate", and you can inspect exactly what each file
 * will contain before the job runs.
 */
export function buildExportPreviewPieces(input: ExportPreviewInput): ExportPreviewPieces {
  const { doc, mode, ppe, cslStyle } = input;
  const profile =
    mode === "publication" ? getPublisherProfile(ppe?.profileId) : undefined;

  const figurePlacement =
    profile && ppe?.placement?.figures
      ? ppe.placement.figures
      : profile?.figurePlacement ?? "inline";
  const tablePlacement =
    profile && ppe?.placement?.tables
      ? ppe.placement.tables
      : profile?.tablePlacement ?? "inline";

  const { doc: augmented } = assignStableIds(doc);
  const { index } = buildCrossReferenceIndex(augmented);

  const pieces: ExportPreviewPieces = {
    manuscriptHtml: buildExportPreviewHtml({ doc, mode, ppe, cslStyle }),
  };

  // Separate Figures document (mirrors buildSubmissionPackage's Figures.html).
  if (figurePlacement !== "inline" && index.figures.length > 0) {
    const figBlocks: BlockNode[] = [];
    for (const e of index.figures) {
      const fig = findFigure(augmented, e.internalId);
      if (fig) figBlocks.push(fig);
      figBlocks.push(heading(e.displayNumber));
      if (e.caption) figBlocks.push(para(`Caption: ${e.caption}`));
      figBlocks.push(horizontalRule());
    }
    pieces.figuresHtml = cdmToHtml(subDoc(augmented, figBlocks), {
      fullDocument: false,
    });
  }

  // Separate Tables document (mirrors buildSubmissionPackage's Tables.html).
  if (tablePlacement !== "inline" && index.tables.length > 0) {
    const tabBlocks: BlockNode[] = [];
    for (const e of index.tables) {
      const tbl = findTable(augmented, e.internalId);
      if (tbl) tabBlocks.push(heading(e.displayNumber), tbl, horizontalRule());
    }
    pieces.tablesHtml = cdmToHtml(subDoc(augmented, tabBlocks), {
      fullDocument: false,
    });
  }

  return pieces;
}

/* --- small CDM helpers (kept local to avoid churning package.ts) --- */

function para(text: string): BlockNode {
  return { type: "paragraph", content: [{ type: "text", text }] };
}
function heading(text: string): BlockNode {
  return { type: "heading", level: 2, content: [{ type: "text", text }] };
}
function horizontalRule(): BlockNode {
  return { type: "horizontalRule" };
}
function subDoc(
  doc: CanonicalDocument,
  body: BlockNode[],
): CanonicalDocument {
  return {
    schemaVersion: "1.0",
    metadata: doc.metadata,
    settings: doc.settings,
    body,
    references: [],
    assets: [],
  };
}
function findFigure(
  doc: CanonicalDocument,
  id: string,
): BlockNode | undefined {
  let found: BlockNode | undefined;
  const visit = (blocks: BlockNode[]): void => {
    for (const b of blocks) {
      if (found) return;
      if (b.type === "figure" && b.id === id) {
        found = b;
        return;
      }
      if (b.type === "bulletList" || b.type === "orderedList")
        for (const it of b.items) visit(it.content);
      if (b.type === "blockquote" || b.type === "appendix") visit(b.content);
      if (b.type === "table")
        for (const row of b.rows)
          for (const cell of row.cells) visit(cell.content);
    }
  };
  visit(doc.body);
  return found;
}
function findTable(
  doc: CanonicalDocument,
  id: string,
): BlockNode | undefined {
  let found: BlockNode | undefined;
  const visit = (blocks: BlockNode[]): void => {
    for (const b of blocks) {
      if (found) return;
      if (b.type === "table" && b.id === id) {
        found = b;
        return;
      }
      if (b.type === "bulletList" || b.type === "orderedList")
        for (const it of b.items) visit(it.content);
      if (b.type === "blockquote" || b.type === "appendix") visit(b.content);
      if (b.type === "table")
        for (const row of b.rows)
          for (const cell of row.cells) visit(cell.content);
    }
  };
  visit(doc.body);
  return found;
}
